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

function initializeApp() {
    updateUserInfo();
    setupEventListeners();
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

// Настройка обработчиков событий
function setupEventListeners() {
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
        
        renderTickets(data.tickets);
        updateStats(data.tickets);
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
        
        showNotification('Тикет успешно создан!', 'success');
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
    const searchInput = document.getElementById('searchInput').value;

    currentFilters = {};
    
    if (statusFilter) currentFilters.status = statusFilter;
    if (categoryFilter) currentFilters.category = categoryFilter;
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
        'в_процессе': 'В процессе',
        'решен': 'Решен',
        'закрыт': 'Закрыт'
    };
    return statusTexts[status] || status;
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
        'критический': 'Критический'
    };
    return priorityTexts[priority] || priority;
}

function updateUserInfo() {
    // В реальной системе здесь будет информация из авторизации
    const userName = localStorage.getItem('userName') || 'Пользователь';
    document.querySelector('.user-name').textContent = userName;
}