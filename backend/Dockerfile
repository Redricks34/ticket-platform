FROM python:3.11-slim

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Создание рабочей директории
WORKDIR /app

# Обновление pip до последней версии
RUN pip install --upgrade pip

# Копирование файла зависимостей
COPY requirements.txt .

# Установка Python зависимостей поэтапно
RUN pip install --no-cache-dir fastapi uvicorn[standard] && \
    pip install --no-cache-dir motor pymongo && \
    pip install --no-cache-dir pydantic pydantic-settings && \
    pip install --no-cache-dir redis websockets && \
    pip install --no-cache-dir python-multipart && \
    pip install --no-cache-dir python-jose[cryptography] passlib[bcrypt]

# Копирование исходного кода приложения
COPY . .

# Создание пользователя для безопасности
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app
USER appuser

# Открытие порта
EXPOSE 8000

# Команда запуска приложения
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]