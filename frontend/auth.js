// Конфигурация API
const API_BASE_URL = 'http://localhost:8000';

// Утилиты для работы с токеном
const TokenManager = {
    setToken(token) {
        localStorage.setItem('auth_token', token);
    },

    getToken() {
        return localStorage.getItem('auth_token');
    },

    removeToken() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
    },

    setUser(user) {
        localStorage.setItem('user_data', JSON.stringify(user));
    },

    getUser() {
        const userData = localStorage.getItem('user_data');
        return userData ? JSON.parse(userData) : null;
    }
};

// API клиент
const AuthAPI = {
    async register(userData) {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Ошибка регистрации');
        }

        return data;
    },

    async login(credentials) {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(credentials)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Ошибка входа');
        }

        return data;
    },

    async getProfile() {
        const token = TokenManager.getToken();
        if (!token) {
            throw new Error('Токен не найден');
        }

        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка получения профиля');
        }

        return response.json();
    },

    async checkSupportStatus() {
        const token = TokenManager.getToken();
        if (!token) {
            return { is_support: false };
        }

        try {
            const response = await fetch(`${API_BASE_URL}/support/check`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                return await response.json();
            }
            return { is_support: false };
        } catch (error) {
            return { is_support: false };
        }
    }
};

// Утилиты UI
const UI = {
    showError(message, elementId = 'error-message') {
        const errorEl = document.getElementById(elementId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    },

    showSuccess(message, elementId = 'success-message') {
        const successEl = document.getElementById(elementId);
        if (successEl) {
            successEl.textContent = message;
            successEl.style.display = 'block';
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 3000);
        }
    },

    setLoading(button, isLoading) {
        if (isLoading) {
            button.disabled = true;
            button.classList.add('loading');
            button.dataset.originalText = button.textContent;
            button.textContent = 'Загрузка...';
        } else {
            button.disabled = false;
            button.classList.remove('loading');
            button.textContent = button.dataset.originalText || button.textContent;
        }
    }
};

// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    const token = TokenManager.getToken();
    const currentPage = window.location.pathname;
    
    // Если пользователь авторизован и находится на странице входа/регистрации
    if (token && (currentPage.includes('login.html') || currentPage.includes('register.html'))) {
        window.location.href = 'index.html';
        return;
    }

    // Если пользователь не авторизован и находится на главной странице
    if (!token && currentPage.includes('index.html')) {
        window.location.href = 'login.html';
        return;
    }

    // Инициализация форм
    initializeForms();
});

function initializeForms() {
    // Форма входа
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Форма регистрации
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const formData = new FormData(form);
    const credentials = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    UI.setLoading(submitBtn, true);

    try {
        const response = await AuthAPI.login(credentials);
        
        // Сохраняем токен и данные пользователя
        TokenManager.setToken(response.access_token);
        TokenManager.setUser(response.user);
        
        UI.showSuccess('Успешный вход! Перенаправление...');
        
        // Перенаправляем на главную страницу
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);

    } catch (error) {
        UI.showError(error.message);
    } finally {
        UI.setLoading(submitBtn, false);
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const formData = new FormData(form);
    
    // Проверяем совпадение паролей
    const password = formData.get('password');
    const confirmPassword = formData.get('confirm_password');
    
    if (password !== confirmPassword) {
        UI.showError('Пароли не совпадают');
        return;
    }

    const userData = {
        email: formData.get('email'),
        username: formData.get('username'),
        full_name: formData.get('full_name'),
        password: password
    };

    UI.setLoading(submitBtn, true);

    try {
        const response = await AuthAPI.register(userData);
        
        // Сохраняем токен и данные пользователя
        TokenManager.setToken(response.access_token);
        TokenManager.setUser(response.user);
        
        UI.showSuccess('Регистрация успешна! Перенаправление...');
        
        // Перенаправляем на главную страницу
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);

    } catch (error) {
        UI.showError(error.message);
    } finally {
        UI.setLoading(submitBtn, false);
    }
}

// Функция выхода из системы
function logout() {
    TokenManager.removeToken();
    window.location.href = 'login.html';
}

// Экспортируем функции для использования в других файлах
window.AuthAPI = AuthAPI;
window.TokenManager = TokenManager;
window.logout = logout;