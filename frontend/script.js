// Конфигурация API
const API_BASE_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/tickets/ws/notifications';

// Глобальные переменные
let currentPage = 1;
let totalPages = 1;
let currentFilters = {};
let websocket = null;
let userEmail = '';
let currentUser = null;
let authToken = '';
let isSupportUser = false;
let currentTicketId = null;
let messagesSocket = null;

// Функция для авторизованных запросов
function getAuthHeaders() {
    return {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
    };
}

async function authorizedFetch(url, options = {}) {
    const headers = {
        ...getAuthHeaders(),
        ...options.headers
    };
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        // Токен истек или недействителен
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
        window.location.href = 'login.html';
        return;
    }
    
    return response;
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', function() {
    checkAuthentication();
});

function checkAuthentication() {
    const token = localStorage.getItem('auth_token');
    const userData = localStorage.getItem('user_data');
    
    if (!token || !userData) {
        window.location.href = 'login.html';
        return;
    }
    
    authToken = token;
    currentUser = JSON.parse(userData);
    userEmail = currentUser.email;
    
    initializeApp();
}

async function initializeApp() {
    updateUserInfo();
    await checkSupportStatus();
    setupEventListeners();
    setupSupportInterface();
    loadUserTickets();
    connectWebSocket();
}

function updateUserInfo() {
    // Обновляем отображение информации о пользователе
    const usernameDisplay = document.getElementById('username-display');
    const userInfo = document.getElementById('user-info');
    
    if (usernameDisplay && currentUser) {
        usernameDisplay.textContent = currentUser.full_name || currentUser.username;
        if (userInfo) {
            userInfo.style.display = 'block';
        }
    }
}

// Функция выхода из системы
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    if (websocket) {
        websocket.close();
    }
    window.location.href = 'login.html';
}

// Проверка статуса техподдержки
async function checkSupportStatus() {
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/support/check`);
        if (response.ok) {
            const data = await response.json();
            isSupportUser = data.is_support;
        }
    } catch (error) {
        // Пользователь не является сотрудником техподдержки
        isSupportUser = false;
    }
}

// Настройка интерфейса для техподдержки
function setupSupportInterface() {
    if (!isSupportUser) return;
    
    // Добавляем вкладки для техподдержки
    const nav = document.querySelector('.nav-list');
    const supportTabsHTML = `
        <li class="nav-item">
            <a href="#" class="nav-link" data-tab="unassigned">
                <i class="fas fa-inbox"></i>
                Новые тикеты
            </a>
        </li>
        <li class="nav-item">
            <a href="#" class="nav-link" data-tab="assigned">
                <i class="fas fa-tasks"></i>
                Принятые
            </a>
        </li>
    `;
    
    // Вставляем перед профилем
    const profileItem = nav.querySelector('[data-tab="profile"]').parentElement;
    profileItem.insertAdjacentHTML('beforebegin', supportTabsHTML);
    
    // Добавляем секции для техподдержки
    const mainContainer = document.querySelector('main .container');
    const supportSectionsHTML = `
        <!-- Новые тикеты для техподдержки -->
        <section id="unassigned-tab" class="tab-content">
            <div class="page-header">
                <h1>Новые тикеты</h1>
                <p class="page-subtitle">Тикеты, ожидающие назначения</p>
            </div>
            <div class="tickets-grid" id="unassignedTicketsGrid">
                <!-- Тикеты будут загружены динамически -->
            </div>
        </section>
        
        <!-- Принятые тикеты -->
        <section id="assigned-tab" class="tab-content">
            <div class="page-header">
                <h1>Принятые тикеты</h1>
                <p class="page-subtitle">Ваши назначенные тикеты</p>
            </div>
            <div class="tickets-grid" id="assignedTicketsGrid">
                <!-- Тикеты будут загружены динамически -->
            </div>
        </section>
    `;
    
    mainContainer.insertAdjacentHTML('beforeend', supportSectionsHTML);
    
    // Переустанавливаем обработчики событий для новых кнопок навигации
    setupNavigationEvents();
}

// Функции для работы с профилем
function loadProfileData() {
    if (!currentUser) return;
    
    // Заполняем информацию о пользователе
    document.getElementById('profile-full-name').textContent = currentUser.full_name;
    document.getElementById('profile-email').textContent = currentUser.email;
    document.getElementById('profile-role').textContent = currentUser.is_support_staff ? 'Сотрудник поддержки' : 'Пользователь';
    
    // Заполняем форму редактирования
    document.getElementById('profileFullName').value = currentUser.full_name;
    document.getElementById('profileUsername').value = currentUser.username;
    document.getElementById('profileEmail').value = currentUser.email;
    
    // Загружаем статистику пользователя
    loadUserStats();
}

async function loadUserStats() {
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/tickets/?reporter_email=${encodeURIComponent(currentUser.email)}&limit=1000`);
        const data = await response.json();
        
        const tickets = data.tickets || [];
        const openTickets = tickets.filter(t => t.status === 'открыт' || t.status === 'в_процессе').length;
        const resolvedTickets = tickets.filter(t => t.status === 'решен' || t.status === 'закрыт').length;
        
        document.getElementById('user-tickets-count').textContent = tickets.length;
        document.getElementById('user-open-tickets').textContent = openTickets;
        document.getElementById('user-resolved-tickets').textContent = resolvedTickets;
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

async function handleProfileUpdate(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const formData = new FormData(form);
    const updateData = {
        full_name: formData.get('full_name') || formData.get('profileFullName'),
        username: formData.get('username') || formData.get('profileUsername')
    };
    
    // Проверяем, что есть изменения
    if (updateData.full_name === currentUser.full_name && updateData.username === currentUser.username) {
        showMessage('Нет изменений для сохранения', 'info');
        return;
    }
    
    setButtonLoading(submitBtn, true);
    
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/auth/me`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка обновления профиля');
        }
        
        const updatedUser = await response.json();
        
        // Обновляем локальные данные
        currentUser = updatedUser;
        TokenManager.setUser(updatedUser);
        
        // Обновляем отображение
        updateUserInfo();
        loadProfileData();
        
        showMessage('Профиль успешно обновлен!', 'success');
        
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

// Настройка обработчиков навигации
function setupNavigationEvents() {
    // Навигация по вкладкам
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (link.id === 'logout-btn') {
                logout();
            } else {
                switchTab(link.dataset.tab);
            }
        });
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Навигация по вкладкам
    setupNavigationEvents();

    // Форма создания тикета - с проверкой существования
    const createForm = document.getElementById('createTicketForm');
    if (createForm) {
        createForm.addEventListener('submit', handleTicketSubmit);
    }
    
    const resetBtn = document.getElementById('resetForm');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetCreateForm);
    }

    // Фильтры - с проверкой существования
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', applyFilters);
    }
    
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', applyFilters);
    }
    
    const priorityFilter = document.getElementById('priorityFilter');
    if (priorityFilter) {
        priorityFilter.addEventListener('change', applyFilters);
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(applyFilters, 500));
    }
    
    // Форма профиля - с проверкой существования
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileUpdate);
    }

    // Модальное окно - с проверкой существования
    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }
    
    const ticketModal = document.getElementById('ticketModal');
    if (ticketModal) {
        ticketModal.addEventListener('click', (e) => {
            if (e.target.id === 'ticketModal') closeModal();
        });
    }

    // Закрытие модального окна по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('ticketModal').classList.contains('active')) {
            closeModal();
        }
    });
}

// Переключение вкладок
function switchTab(tabName) {
    // Обновляем активную навигацию
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }

    // Скрываем все вкладки (и tab-content, и tab-section)
    document.querySelectorAll('.tab-content').forEach(section => {
        section.classList.remove('active');
        section.style.display = 'none';
    });
    document.querySelectorAll('.tab-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Показываем нужную вкладку
    let targetSection;
    if (tabName === 'home') {
        targetSection = document.getElementById('home-tab');
    } else if (tabName === 'create') {
        targetSection = document.getElementById('create-tab');
    } else if (tabName === 'unassigned') {
        targetSection = document.getElementById('unassigned-tab');
    } else if (tabName === 'assigned') {
        targetSection = document.getElementById('assigned-tab');
    } else if (tabName === 'profile') {
        targetSection = document.getElementById('profile');
    }
    
    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.style.display = 'block';
    }

    // Загружаем данные в зависимости от вкладки
    if (tabName === 'home') {
        loadUserTickets();
    } else if (tabName === 'create') {
        prefillTicketForm();
    } else if (tabName === 'unassigned') {
        loadUnassignedTickets();
    } else if (tabName === 'assigned') {
        loadAssignedTickets();
    } else if (tabName === 'profile') {
        loadProfileData();
    }
}

// Загрузка тикетов пользователя
async function loadUserTickets() {
    showLoading(true);
    
    try {
        const params = new URLSearchParams({
            reporter_email: userEmail,
            page: currentPage,
            page_size: 12,
            ...currentFilters
        });

        const response = await authorizedFetch(`${API_BASE_URL}/tickets/?${params}`);
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки тикетов');
        }

        const data = await response.json();
        
        // Сортируем тикеты: сначала активные, потом закрытые
        const sortedTickets = data.tickets.sort((a, b) => {
            const statusOrder = { 'открыт': 1, 'в работе': 2, 'закрыт': 3 };
            return (statusOrder[a.status] || 1) - (statusOrder[b.status] || 1);
        });
        
        renderTickets(sortedTickets);
        updateStats(sortedTickets);
        renderPagination(data);
        
    } catch (error) {
        console.error('Ошибка загрузки тикетов:', error);
        showNotification('Ошибка загрузки тикетов', 'error');
        renderEmptyState();
    } finally {
        showLoading(false);
    }
}

// Отображение тикетов
function renderTickets(tickets) {
    const container = document.getElementById('ticketsGrid');
    
    if (!tickets || tickets.length === 0) {
        renderEmptyState();
        return;
    }

    container.innerHTML = tickets.map(ticket => `
        <div class="ticket-card priority-${ticket.priority}" onclick="openTicketModal('${ticket.id}')">
            <div class="ticket-header">
                <span class="ticket-id">#${ticket.id.substring(0, 8)}</span>
            </div>
            
            <h3 class="ticket-title">${escapeHtml(ticket.title)}</h3>
            
            <div class="ticket-meta">
                <span class="ticket-status status-${ticket.status}">
                    <i class="fas fa-circle"></i>
                    ${getStatusText(ticket.status)}
                </span>
                <span class="ticket-category">
                    <i class="fas fa-tag"></i>
                    ${getCategoryText(ticket.category)}
                </span>
                <span class="ticket-priority">
                    <i class="fas fa-exclamation-triangle"></i>
                    ${getPriorityText(ticket.priority)}
                </span>
            </div>
            
            <div class="ticket-description">
                ${escapeHtml(ticket.description)}
            </div>
            
            <div class="ticket-footer">
                <span class="ticket-date">
                    <i class="fas fa-calendar"></i>
                    ${formatDate(ticket.created_at)}
                </span>
                <span class="ticket-comments">
                    <i class="fas fa-comment"></i>
                    ${ticket.comments_count} комм.
                    ${ticket.comments_count > 0 ? '<span class="new-comment-indicator">есть ответ</span>' : ''}
                </span>
            </div>
        </div>
    `).join('');
}

// Обновление статистики
function updateStats(tickets) {
    const stats = {
        total: tickets.length,
        open: tickets.filter(t => t.status === 'открыт').length,
        progress: tickets.filter(t => t.status === 'в_процессе').length,
        resolved: tickets.filter(t => t.status === 'решен' || t.status === 'закрыт').length
    };

    document.getElementById('totalTickets').textContent = stats.total;
    document.getElementById('openTickets').textContent = stats.open;
    document.getElementById('progressTickets').textContent = stats.progress;
    document.getElementById('resolvedTickets').textContent = stats.resolved;
}

// Пустое состояние
function renderEmptyState() {
    const container = document.getElementById('ticketsGrid');
    container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
            <i class="fas fa-inbox"></i>
            <h3>Нет тикетов</h3>
            <p>Вы еще не создали ни одного тикета или они не соответствуют текущим фильтрам.</p>
            <button class="btn btn-primary" onclick="switchTab('create')">
                <i class="fas fa-plus"></i>
                Создать первый тикет
            </button>
        </div>
    `;
}

// Автозаполнение формы создания тикета
function prefillTicketForm() {
    if (!currentUser) return;
    
    const nameField = document.getElementById('reporterName');
    const emailField = document.getElementById('reporterEmail');
    
    if (nameField && currentUser.full_name) {
        nameField.value = currentUser.full_name;
        nameField.setAttribute('readonly', true);
        nameField.style.backgroundColor = '#f8f9fa';
    }
    
    if (emailField && currentUser.email) {
        emailField.value = currentUser.email;
        emailField.setAttribute('readonly', true);
        emailField.style.backgroundColor = '#f8f9fa';
    }
}

// Создание тикета
async function handleTicketSubmit(e) {
    e.preventDefault();
    
    const submitButton = document.getElementById('submitTicket');
    const originalText = submitButton.innerHTML;
    
    // Блокируем кнопку
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Создаем...';

    try {
        const formData = {
            title: document.getElementById('ticketTitle').value,
            description: document.getElementById('ticketDescription').value,
            category: document.getElementById('ticketCategory').value,
            reporter_name: document.getElementById('reporterName').value,
            reporter_email: document.getElementById('reporterEmail').value
        };

        const response = await authorizedFetch(`${API_BASE_URL}/tickets/`, {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка создания тикета');
        }

        const ticket = await response.json();
        
        // Уведомление будет показано через WebSocket
        resetCreateForm();
        
        // Переключаемся на главную и обновляем список
        switchTab('home');
        
        // Сохраняем email пользователя
        localStorage.setItem('userEmail', formData.reporter_email);
        userEmail = formData.reporter_email;
        
    } catch (error) {
        console.error('Ошибка создания тикета:', error);
        showNotification(error.message || 'Ошибка создания тикета', 'error');
    } finally {
        // Возвращаем кнопку в исходное состояние
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

// Сброс формы
function resetCreateForm() {
    // Очищаем только редактируемые поля
    document.getElementById('ticketTitle').value = '';
    document.getElementById('ticketCategory').value = '';
    document.getElementById('ticketDescription').value = '';
    
    // Имя и email не очищаем - они автозаполняются
    // prefillTicketForm(); // Заново заполним поля пользователя
}

// Применение фильтров
function applyFilters() {
    const statusFilter = document.getElementById('statusFilter').value;
    const categoryFilter = document.getElementById('categoryFilter').value;
    const priorityFilter = document.getElementById('priorityFilter').value;
    const searchInput = document.getElementById('searchInput').value;

    currentFilters = {};
    
    if (statusFilter) currentFilters.status = statusFilter;
    if (categoryFilter) currentFilters.category = categoryFilter;
    if (priorityFilter) currentFilters.priority = priorityFilter;
    if (searchInput.trim()) currentFilters.search_text = searchInput.trim();

    currentPage = 1; // Сбрасываем на первую страницу
    loadUserTickets();
}

// Пагинация
function renderPagination(data) {
    const container = document.getElementById('pagination');
    totalPages = data.total_pages;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let paginationHTML = '';
    
    // Предыдущая страница
    paginationHTML += `
        <button ${currentPage <= 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">
            <i class="fas fa-chevron-left"></i>
        </button>
    `;

    // Номера страниц
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        paginationHTML += `
            <button class="${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">
                ${i}
            </button>
        `;
    }

    // Следующая страница
    paginationHTML += `
        <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">
            <i class="fas fa-chevron-right"></i>
        </button>
    `;

    container.innerHTML = paginationHTML;
}

function changePage(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    
    currentPage = page;
    loadUserTickets();
}

// Модальное окно тикета
async function openTicketModal(ticketId) {
    try {
        showLoading(true);
        
        const response = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}`);
        if (!response.ok) {
            throw new Error('Тикет не найден');
        }

        const ticket = await response.json();
        renderTicketModal(ticket);
        
        document.getElementById('ticketModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('Ошибка загрузки тикета:', error);
        showNotification('Ошибка загрузки тикета', 'error');
    } finally {
        showLoading(false);
    }
}

function renderTicketModal(ticket) {
    document.getElementById('modalTicketTitle').textContent = ticket.title;
    
    const modalBody = document.getElementById('modalTicketBody');
    modalBody.innerHTML = `
        <div class="ticket-full">
            <div class="ticket-info">
                <div class="info-row">
                    <strong>ID:</strong> #${ticket.id.substring(0, 8)}
                </div>
                <div class="info-row">
                    <strong>Статус:</strong> 
                    <span class="ticket-status status-${ticket.status}">${getStatusText(ticket.status)}</span>
                </div>
                <div class="info-row">
                    <strong>Категория:</strong> ${getCategoryText(ticket.category)}
                </div>
                <div class="info-row">
                    <strong>Приоритет:</strong> 
                    <span class="priority-badge priority-${ticket.priority}">${getPriorityText(ticket.priority)}</span>
                </div>
                <div class="info-row">
                    <strong>Автор:</strong> ${escapeHtml(ticket.reporter_name)} (${escapeHtml(ticket.reporter_email)})
                </div>
                <div class="info-row">
                    <strong>Создан:</strong> ${formatDateTime(ticket.created_at)}
                </div>
                ${ticket.updated_at !== ticket.created_at ? `
                <div class="info-row">
                    <strong>Обновлен:</strong> ${formatDateTime(ticket.updated_at)}
                </div>
                ` : ''}
            </div>
            
            <div class="ticket-content">
                <h4>Описание проблемы:</h4>
                <div class="description-content">
                    ${escapeHtml(ticket.description).replace(/\n/g, '<br>')}
                </div>
            </div>

            ${ticket.comments_count > 0 ? `
            <div class="ticket-comments">
                <h4>Комментарии службы поддержки:</h4>
                <div id="commentsContainer">
                    <div class="loading-comments">
                        <i class="fas fa-spinner fa-spin"></i> Загрузка комментариев...
                    </div>
                </div>
            </div>
            ` : `
            <div class="no-comments">
                <i class="fas fa-comment-slash"></i>
                <p>Пока нет комментариев от службы поддержки</p>
            </div>
            `}
        </div>
    `;

    // Загружаем комментарии, если они есть
    if (ticket.comments_count > 0) {
        loadTicketComments(ticket.id);
    }
}

// Загрузка комментариев (симуляция, так как в API нет отдельного endpoint)
async function loadTicketComments(ticketId) {
    // В реальном приложении здесь был бы отдельный endpoint для комментариев
    // Пока симулируем комментарии
    setTimeout(() => {
        const container = document.getElementById('commentsContainer');
        if (container) {
            container.innerHTML = `
                <div class="comment">
                    <div class="comment-header">
                        <strong>Служба поддержки</strong>
                        <span class="comment-date">${formatDateTime(new Date())}</span>
                    </div>
                    <div class="comment-content">
                        Спасибо за обращение! Мы рассмотрим вашу заявку в ближайшее время.
                    </div>
                </div>
            `;
        }
    }, 1000);
}

function closeModal() {
    document.getElementById('ticketModal').classList.remove('active');
    document.body.style.overflow = '';
}

// WebSocket подключение
function connectWebSocket() {
    try {
        websocket = new WebSocket(WS_URL);
        
        websocket.onopen = () => {
            console.log('WebSocket подключен');
        };
        
        websocket.onmessage = (event) => {
            try {
                const notification = JSON.parse(event.data);
                if (notification.event !== 'connected') {
                    handleWebSocketNotification(notification);
                }
            } catch (error) {
                console.error('Ошибка обработки WebSocket сообщения:', error);
            }
        };
        
        websocket.onclose = () => {
            console.log('WebSocket отключен. Переподключение через 5 секунд...');
            setTimeout(connectWebSocket, 5000);
        };
        
        websocket.onerror = (error) => {
            console.error('Ошибка WebSocket:', error);
        };
    } catch (error) {
        console.error('Ошибка подключения WebSocket:', error);
        // Попробуем переподключиться через 10 секунд
        setTimeout(connectWebSocket, 10000);
    }
}

// Обработка WebSocket уведомлений
function handleWebSocketNotification(notification) {
    // Показываем уведомление только если тикет относится к текущему пользователю
    if (notification.ticket && notification.ticket.reporter_email === userEmail) {
        let message = '';
        
        switch (notification.event) {
            case 'created':
                message = `Тикет "${notification.ticket.title}" создан`;
                break;
            case 'updated':
                message = `Тикет "${notification.ticket.title}" обновлен`;
                break;
            case 'comment_added':
                message = `Новый комментарий к тикету "${notification.ticket.title}"`;
                break;
        }
        
        if (message) {
            showNotification(message, 'success');
            
            // Обновляем список тикетов, если мы на главной странице
            if (document.getElementById('home-tab').classList.contains('active')) {
                loadUserTickets();
            }
        }
    }
}

// Утилиты
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.add('active');
    } else {
        loading.classList.remove('active');
    }
}

function showNotification(message, type = 'success') {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    container.appendChild(notification);
    
    // Автоматически удаляем уведомление через 5 секунд
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

// Функции техподдержки
async function loadUnassignedTickets() {
    if (!isSupportUser) return;
    
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/support/tickets/unassigned`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки новых тикетов');
        }
        
        const data = await response.json();
        renderSupportTickets(data.tickets, 'unassignedTicketsGrid', true);
    } catch (error) {
        console.error('Ошибка загрузки новых тикетов:', error);
        showNotification('Ошибка загрузки новых тикетов', 'error');
    }
}

async function loadAssignedTickets() {
    if (!isSupportUser) return;
    
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/support/tickets/assigned`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки принятых тикетов');
        }
        
        const data = await response.json();
        renderSupportTickets(data.tickets, 'assignedTicketsGrid', false);
    } catch (error) {
        console.error('Ошибка загрузки принятых тикетов:', error);
        showNotification('Ошибка загрузки принятых тикетов', 'error');
    }
}

function renderSupportTickets(tickets, containerId, showAcceptButton = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (tickets.length === 0) {
        container.innerHTML = '<div class="no-tickets">Нет тикетов</div>';
        return;
    }
    
    container.innerHTML = tickets.map(ticket => `
        <div class="ticket-card priority-${ticket.priority}" data-ticket-id="${ticket.id}">
            <div class="ticket-header">
                <div class="ticket-meta">
                    <span class="ticket-id">#${ticket.id.substring(0, 8)}</span>
                    <span class="ticket-date">${new Date(ticket.created_at).toLocaleDateString()}</span>
                </div>
                <div class="ticket-badges">
                    <span class="status-badge status-${ticket.status}">${ticket.status}</span>
                    <span class="priority-badge priority-${ticket.priority}">${ticket.priority}</span>
                </div>
            </div>
            <h3 class="ticket-title">${ticket.title}</h3>
            <p class="ticket-description">${ticket.description.substring(0, 150)}...</p>
            <div class="ticket-footer">
                <div class="ticket-reporter">
                    <i class="fas fa-user"></i>
                    <span>${ticket.reporter_name}</span>
                </div>
                <div class="ticket-actions">
                    ${showAcceptButton ? `
                        <button class="btn btn-primary btn-sm" onclick="showAcceptTicketModal('${ticket.id}')">
                            <i class="fas fa-hand-paper"></i>
                            Принять
                        </button>
                    ` : `
                        <button class="btn btn-secondary btn-sm" onclick="openSupportTicketModal('${ticket.id}')">
                            <i class="fas fa-comments"></i>
                            Открыть чат
                        </button>
                    `}
                </div>
            </div>
        </div>
    `).join('');
}

async function acceptTicket(ticketId) {
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/support/tickets/${ticketId}/assign`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка принятия тикета');
        }
        
        showNotification('Тикет успешно принят!', 'success');
        
        // Обновляем списки
        loadUnassignedTickets();
        loadAssignedTickets();
        
    } catch (error) {
        console.error('Ошибка принятия тикета:', error);
        showNotification(error.message, 'error');
    }
}

async function openSupportTicketModal(ticketId) {
    console.log('Открываем модальное окно для тикета:', ticketId, '(старый currentTicketId:', currentTicketId, ')');
    currentTicketId = ticketId;
    console.log('currentTicketId обновлён на:', currentTicketId);
    
    try {
        // Загружаем детали тикета
        const ticketResponse = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}`);
        if (!ticketResponse.ok) {
            throw new Error('Ошибка загрузки тикета');
        }
        const ticket = await ticketResponse.json();
        
        // Загружаем сообщения
        const messagesResponse = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}/messages`);
        if (!messagesResponse.ok) {
            throw new Error('Ошибка загрузки сообщений');
        }
        const messages = await messagesResponse.json();
        
        renderSupportTicketModal(ticket, messages);
        
        // Показываем модальное окно
        const modal = document.getElementById('supportTicketModal');
        if (modal) {
            modal.style.display = 'block';
            modal.classList.add('active');
            // Блокируем прокрутку фона
            document.body.classList.add('modal-open');
            console.log('Модальное окно открыто для тикета:', ticketId);
        }
        
        // Отмечаем как прочитанные
        await authorizedFetch(`${API_BASE_URL}/support/tickets/${ticketId}/mark-read`, {
            method: 'POST'
        });
        
    } catch (error) {
        console.error('Ошибка загрузки тикета:', error);
        showNotification('Ошибка загрузки тикета', 'error');
    }
}

function renderSupportTicketModal(ticket, messages) {
    // Обновляем заголовок
    document.getElementById('supportModalTicketTitle').textContent = `Тикет #${ticket.id.substring(0, 8)}`;
    
    // Рендерим детали тикета
    const ticketDetails = document.getElementById('supportTicketDetails');
    ticketDetails.innerHTML = `
        <div class="detail-group">
            <div class="detail-label">Заголовок</div>
            <div class="detail-value"><strong>${ticket.title}</strong></div>
        </div>
        <div class="detail-group">
            <div class="detail-label">Описание</div>
            <div class="detail-value">${ticket.description}</div>
        </div>
        <div class="detail-group">
            <div class="detail-label">Статус</div>
            <div class="detail-value">
                <span class="status-badge status-${ticket.status}">${ticket.status}</span>
            </div>
        </div>
        <div class="detail-group">
            <div class="detail-label">Приоритет</div>
            <div class="detail-value">
                <span class="priority-badge priority-${ticket.priority}">${ticket.priority}</span>
            </div>
        </div>
        <div class="detail-group">
            <div class="detail-label">Автор</div>
            <div class="detail-value">
                <strong>${ticket.reporter_name}</strong><br>
                <small>${ticket.reporter_email}</small>
            </div>
        </div>
        <div class="detail-group">
            <div class="detail-label">Создан</div>
            <div class="detail-value">${new Date(ticket.created_at).toLocaleString()}</div>
        </div>
    `;
    
    // Рендерим сообщения
    renderChatMessages(messages);
    
    // Добавляем управление тикетом
    addTicketManagementToChat(ticket.id, ticket);
    
    // Настраиваем обработчики
    setupChatEventListeners();
}

function renderChatMessages(messages) {
    const chatContainer = document.getElementById('chatMessages');
    
    if (messages.length === 0) {
        chatContainer.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 2rem;">Сообщений пока нет</div>';
        return;
    }
    
    chatContainer.innerHTML = messages.map(message => `
        <div class="chat-message ${message.is_support ? 'support' : 'user'}">
            <div class="message-bubble">
                ${message.content}
            </div>
            <div class="message-meta">
                ${message.author_name} • ${new Date(message.created_at).toLocaleString()}
            </div>
        </div>
    `).join('');
    
    // Прокручиваем к последнему сообщению
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setupChatEventListeners() {
    // Закрытие модального окна
    const closeBtn = document.getElementById('closeSupportModal');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const modal = document.getElementById('supportTicketModal');
            if (modal) {
                modal.classList.remove('active');
                modal.style.display = 'none';
                // Разблокируем прокрутку фона
                document.body.classList.remove('modal-open');
            }
            console.log('Модальное окно закрывается через крестик. currentTicketId:', currentTicketId, '→ null');
            currentTicketId = null;
            console.log('Модальное окно закрыто через крестик');
        };
    }
    
    // Закрытие по клику на фон
    const modal = document.getElementById('supportTicketModal');
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                modal.style.display = 'none';
                // Разблокируем прокрутку фона
                document.body.classList.remove('modal-open');
                console.log('Модальное окно закрывается по клику на фон. currentTicketId:', currentTicketId, '→ null');
                currentTicketId = null;
                console.log('Модальное окно закрыто по клику на фон');
            }
        };
    }
    
    // Отправка сообщения
    const sendBtn = document.getElementById('sendMessage');
    const chatInput = document.getElementById('chatInput');
    
    const sendMessage = async () => {
        const content = chatInput.value.trim();
        if (!content || !currentTicketId) {
            console.log('Отправка сообщения отменена. content:', !!content, 'currentTicketId:', currentTicketId);
            return;
        }
        
        try {
            console.log('Отправляем сообщение для тикета:', currentTicketId);
            const messageData = {
                content: content,
                author_email: currentUser.email,
                author_name: currentUser.full_name
            };
            
            const response = await authorizedFetch(`${API_BASE_URL}/tickets/${currentTicketId}/messages`, {
                method: 'POST',
                body: JSON.stringify(messageData)
            });
            
            if (!response.ok) {
                throw new Error('Ошибка отправки сообщения');
            }
            
            const newMessage = await response.json();
            
            // Добавляем сообщение в чат
            const chatContainer = document.getElementById('chatMessages');
            const messageHTML = `
                <div class="chat-message support">
                    <div class="message-bubble">
                        ${newMessage.content}
                    </div>
                    <div class="message-meta">
                        ${newMessage.author_name} • ${new Date(newMessage.created_at).toLocaleString()}
                    </div>
                </div>
            `;
            
            chatContainer.insertAdjacentHTML('beforeend', messageHTML);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            // Очищаем поле ввода
            chatInput.value = '';
            
        } catch (error) {
            console.error('Ошибка отправки сообщения:', error);
            showNotification('Ошибка отправки сообщения', 'error');
        }
    };
    
    if (sendBtn) {
        sendBtn.onclick = sendMessage;
    }
    
    if (chatInput) {
        chatInput.onkeypress = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        };
    }
    
    // Обработчики для кнопок управления тикетом
    const updatePriorityBtn = document.getElementById('updatePriorityBtn');
    const closeTicketBtn = document.getElementById('closeTicketBtn');
    
    if (updatePriorityBtn) {
        updatePriorityBtn.onclick = () => {
            console.log('Нажата кнопка обновления приоритета. currentTicketId:', currentTicketId);
            if (currentTicketId) {
                updateTicketPriority(currentTicketId);
            } else {
                console.warn('currentTicketId не установлен, невозможно обновить приоритет');
            }
        };
    }
    
    if (closeTicketBtn) {
        closeTicketBtn.onclick = () => {
            console.log('Нажата кнопка закрытия тикета. currentTicketId:', currentTicketId);
            if (currentTicketId) {
                closeTicket(currentTicketId);
            } else {
                console.warn('currentTicketId не установлен, невозможно закрыть тикет');
            }
        };
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU');
}

function getStatusText(status) {
    const statusTexts = {
        'открыт': 'Открыт',
        'в работе': 'В работе',
        'в_процессе': 'В работе',
        'впроцессе': 'В работе',
        'решен': 'Решен',
        'закрыт': 'Закрыт'
    };
    return statusTexts[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

function getCategoryText(category) {
    const categoryTexts = {
        'техническая': 'Техническая',
        'биллинг': 'Биллинг',
        'общий': 'Общий вопрос',
        'баг_репорт': 'Баг репорт',
        'запрос_функции': 'Запрос функции'
    };
    return categoryTexts[category] || category;
}

function getPriorityText(priority) {
    const priorityTexts = {
        'низкий': 'Низкий',
        'средний': 'Средний', 
        'высокий': 'Высокий',
        'критический': 'Критический',
        'не определён': 'Не определён',
        'не_определён': 'Не определён',
        'неопределён': 'Не определён'
    };
    return priorityTexts[priority] || priority.charAt(0).toUpperCase() + priority.slice(1).replace(/_/g, ' ');
}

function updateUserInfo() {
    // В реальной системе здесь будет информация из авторизации
    const userName = localStorage.getItem('userName') || 'Пользователь';
    document.querySelector('.user-name').textContent = userName;
}

// Модальное окно принятия тикета
let currentAcceptTicketId = null;

function showAcceptTicketModal(ticketId) {
    currentAcceptTicketId = ticketId;
    
    // Загружаем данные тикета
    loadTicketForAccept(ticketId);
    
    // Показываем модальное окно
    const modal = document.getElementById('acceptTicketModal');
    modal.style.display = 'flex';
    
    // Настраиваем обработчики
    document.getElementById('closeAcceptModal').onclick = closeAcceptModal;
    document.getElementById('cancelAccept').onclick = closeAcceptModal;
    document.getElementById('confirmAccept').onclick = confirmAcceptTicket;
}

function closeAcceptModal() {
    const modal = document.getElementById('acceptTicketModal');
    modal.style.display = 'none';
    currentAcceptTicketId = null;
}

async function loadTicketForAccept(ticketId) {
    try {
        const response = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки тикета');
        }
        
        const ticket = await response.json();
        
        const detailsHTML = `
            <div class="ticket-preview">
                <h3>${ticket.title}</h3>
                <p><strong>ID:</strong> #${ticket.id.substring(0, 8)}</p>
                <p><strong>Статус:</strong> ${getStatusText(ticket.status)}</p>
                <p><strong>Текущий приоритет:</strong> ${getPriorityText(ticket.priority)}</p>
                <p><strong>Автор:</strong> ${ticket.reporter_name}</p>
                <p><strong>Создан:</strong> ${new Date(ticket.created_at).toLocaleString()}</p>
                <div class="ticket-description">
                    <strong>Описание:</strong>
                    <p>${ticket.description}</p>
                </div>
            </div>
        `;
        
        document.getElementById('acceptTicketDetails').innerHTML = detailsHTML;
    } catch (error) {
        showNotification('Ошибка загрузки данных тикета', 'error');
        console.error('Error loading ticket:', error);
    }
}

async function confirmAcceptTicket() {
    if (!currentAcceptTicketId) return;
    
    const priority = document.getElementById('acceptPriority').value;
    console.log('Accepting ticket:', currentAcceptTicketId, 'with priority:', priority);
    
    try {
        // Принимаем тикет
        console.log('Sending assign request to:', `${API_BASE_URL}/support/tickets/${currentAcceptTicketId}/assign`);
        const assignResponse = await authorizedFetch(`${API_BASE_URL}/support/tickets/${currentAcceptTicketId}/assign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Assign response status:', assignResponse.status);
        
        if (!assignResponse.ok) {
            const errorText = await assignResponse.text();
            console.error('Assign error response:', errorText);
            throw new Error(`Ошибка принятия тикета: ${errorText}`);
        }
        
        const assignResult = await assignResponse.json();
        console.log('Ticket assigned successfully:', assignResult);
        
        // Обновляем приоритет
        console.log('Updating priority to:', priority);
        const priorityResponse = await authorizedFetch(`${API_BASE_URL}/tickets/${currentAcceptTicketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ priority: priority })
        });
        
        console.log('Priority response status:', priorityResponse.status);
        
        if (!priorityResponse.ok) {
            const priorityErrorText = await priorityResponse.text();
            console.warn('Не удалось обновить приоритет:', priorityErrorText);
            showNotification('Тикет принят, но не удалось обновить приоритет', 'warning');
        } else {
            console.log('Priority updated successfully');
        }
        
        showNotification('Тикет успешно принят!', 'success');
        closeAcceptModal();
        
        // Обновляем список тикетов
        console.log('Refreshing ticket lists...');
        await Promise.all([
            loadUnassignedTickets(),
            loadAssignedTickets()
        ]);
        console.log('Ticket lists refreshed');
        
    } catch (error) {
        console.error('Error accepting ticket:', error);
        showNotification('Ошибка при принятии тикета: ' + error.message, 'error');
    }
}

// Добавляем кнопки управления в чат
function addTicketManagementToChat(ticketId, ticket) {
    const chatModal = document.getElementById('supportTicketModal');
    if (!chatModal) {
        console.error('Support ticket modal not found');
        return;
    }
    
    const existingControls = chatModal.querySelector('.ticket-controls');
    
    if (!existingControls) {
        const controlsHTML = `
            <div class="ticket-controls" style="padding: 15px; border-top: 1px solid #e2e8f0; background: #f8fafc;">
                <div class="form-group">
                    <label for="chatPriority">Приоритет:</label>
                    <select id="chatPriority" class="form-control" style="margin-bottom: 10px;">
                        <option value="низкий" ${ticket.priority === 'низкий' ? 'selected' : ''}>Низкий</option>
                        <option value="средний" ${ticket.priority === 'средний' ? 'selected' : ''}>Средний</option>
                        <option value="высокий" ${ticket.priority === 'высокий' ? 'selected' : ''}>Высокий</option>
                        <option value="критический" ${ticket.priority === 'критический' ? 'selected' : ''}>Критический</option>
                    </select>
                </div>
                <div class="ticket-actions">
                    <button id="updatePriorityBtn" class="btn btn-primary btn-sm">
                        <i class="fas fa-save"></i>
                        Обновить приоритет
                    </button>
                    <button id="closeTicketBtn" class="btn btn-success btn-sm">
                        <i class="fas fa-check"></i>
                        Закрыть тикет
                    </button>
                </div>
            </div>
        `;
        
        // Ищем правильный контейнер для вставки
        const chatInputContainer = chatModal.querySelector('.chat-input-container');
        const supportModalBody = chatModal.querySelector('.support-modal-body');
        
        if (chatInputContainer) {
            chatInputContainer.insertAdjacentHTML('afterend', controlsHTML);
            console.log('Ticket controls added after chat input container');
        } else if (supportModalBody) {
            supportModalBody.insertAdjacentHTML('beforeend', controlsHTML);
            console.log('Ticket controls added to modal body');
        } else {
            console.error('No suitable container found for ticket controls');
        }
    }
}

async function updateTicketPriority(ticketId) {
    // Проверяем, что ticketId соответствует текущему открытому тикету
    if (!ticketId || ticketId !== currentTicketId) {
        console.warn('Попытка обновить приоритет некорректного тикета. ticketId:', ticketId, 'currentTicketId:', currentTicketId);
        return;
    }
    
    const prioritySelect = document.getElementById('chatPriority');
    if (!prioritySelect) {
        console.error('Элемент chatPriority не найден');
        return;
    }
    
    const priority = prioritySelect.value;
    
    try {
        console.log('Обновляем приоритет тикета:', ticketId, 'на:', priority, '(currentTicketId:', currentTicketId, ')');
        
        const response = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ priority: priority })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка обновления приоритета:', errorText);
            throw new Error(`Ошибка обновления приоритета: ${errorText}`);
        }
        
        const updatedTicket = await response.json();
        console.log('Приоритет успешно обновлён:', updatedTicket.priority);
        
        // Обновляем отображение приоритета в чате
        updateChatPriorityDisplay(updatedTicket.priority);
        
        showNotification('Приоритет тикета обновлен!', 'success');
        
        // Обновляем списки тикетов
        await loadUnassignedTickets();
        await loadAssignedTickets();
        
    } catch (error) {
        showNotification('Ошибка при обновлении приоритета: ' + error.message, 'error');
        console.error('Error updating priority:', error);
    }
}

async function closeTicket(ticketId) {
    // Проверяем, что ticketId соответствует текущему открытому тикету
    if (!ticketId || ticketId !== currentTicketId) {
        console.warn('Попытка закрыть некорректный тикет. ticketId:', ticketId, 'currentTicketId:', currentTicketId);
        return;
    }
    
    if (!confirm('Вы уверены, что хотите закрыть этот тикет?')) {
        return;
    }
    
    try {
        console.log('Закрываем тикет:', ticketId, '(currentTicketId:', currentTicketId, ')');
        
        const response = await authorizedFetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'закрыт' })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка закрытия тикета:', errorText);
            throw new Error(`Ошибка закрытия тикета: ${errorText}`);
        }
        
        const updatedTicket = await response.json();
        console.log('Тикет успешно закрыт:', updatedTicket);
        
        // Обновляем отображение статуса в чате
        updateChatStatusDisplay('закрыт');
        
        showNotification('Тикет успешно закрыт!', 'success');
        
        // Обновляем списки тикетов перед закрытием модального окна
        await loadUnassignedTickets();
        await loadAssignedTickets();
        
        // Полностью очищаем и закрываем модальное окно
        const modal = document.getElementById('supportTicketModal');
        if (modal) {
            // Очищаем содержимое
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) chatMessages.innerHTML = '';
            
            const ticketDetails = document.getElementById('supportTicketDetails');
            if (ticketDetails) ticketDetails.innerHTML = '';
            
            // Удаляем все классы и скрываем
            modal.classList.remove('active');
            modal.style.display = 'none';
            // Разблокируем прокрутку фона
            document.body.classList.remove('modal-open');
        }
        
        // Очищаем текущий тикет сразу после закрытия
        console.log('Очищаем currentTicketId:', currentTicketId, '→ null');
        currentTicketId = null;
        
        console.log('Модальное окно закрыто, тикет:', ticketId, 'статус закрыт');
        
    } catch (error) {
        showNotification('Ошибка при закрытии тикета: ' + error.message, 'error');
        console.error('Error closing ticket:', error);
    }
}

// Обновляет отображение приоритета в интерфейсе чата
function updateChatPriorityDisplay(newPriority) {
    console.log('Обновляем отображение приоритета на:', newPriority);
    
    // Обновляем значение в выпадающем списке
    const chatPrioritySelect = document.getElementById('chatPriority');
    if (chatPrioritySelect) {
        chatPrioritySelect.value = newPriority;
        console.log('Приоритет в селекте обновлен на:', newPriority);
    }
    
    // Обновляем отображение в деталях тикета
    const ticketDetails = document.getElementById('supportTicketDetails');
    if (ticketDetails) {
        const priorityBadge = ticketDetails.querySelector('.priority-badge');
        if (priorityBadge) {
            // Удаляем старые классы приоритета
            priorityBadge.classList.remove('priority-низкий', 'priority-средний', 'priority-высокий', 'priority-критический', 'priority-не_определён');
            // Добавляем новый класс
            priorityBadge.classList.add(`priority-${newPriority}`);
            // Обновляем текст
            priorityBadge.textContent = getPriorityText(newPriority);
            console.log('Бейдж приоритета обновлен на:', getPriorityText(newPriority));
        }
    }
}

// Обновляет отображение статуса в интерфейсе чата  
function updateChatStatusDisplay(newStatus) {
    console.log('Обновляем отображение статуса на:', newStatus);
    
    // Обновляем отображение в деталях тикета
    const ticketDetails = document.getElementById('supportTicketDetails');
    if (ticketDetails) {
        const statusBadge = ticketDetails.querySelector('.status-badge');
        if (statusBadge) {
            // Удаляем старые классы статуса
            statusBadge.classList.remove('status-открыт', 'status-в_работе', 'status-решен', 'status-закрыт');
            // Добавляем новый класс
            statusBadge.classList.add(`status-${newStatus}`);
            // Обновляем текст
            statusBadge.textContent = getStatusText(newStatus);
            console.log('Бейдж статуса обновлен на:', getStatusText(newStatus));
        }
    }
}

