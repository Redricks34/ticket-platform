from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from database import Database
from notifications import notification_service
from routes import router as tickets_router

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Управление жизненным циклом приложения."""
    # Запуск
    logger.info("Запуск приложения...")
    
    # Подключение к базе данных
    await Database.connect_db()
    
    # Подключение к сервису уведомлений
    await notification_service.connect()
    
    logger.info("Приложение успешно запущено!")
    
    yield
    
    # Завершение
    logger.info("Завершение работы приложения...")
    
    # Закрытие подключений
    await Database.close_db()
    await notification_service.disconnect()
    
    logger.info("Приложение завершило работу.")

# Создание приложения FastAPI
app = FastAPI(
    title="Ticket Platform API",
    description="API для системы техподдержки с тикетами",
    version="1.0.0",
    lifespan=lifespan
)

# Настройка CORS для разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # В продакшене указать конкретные домены
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение маршрутов
app.include_router(tickets_router)

# Основной endpoint для проверки работоспособности
@app.get("/", summary="Проверка работоспособности")
async def root():
    """
    Основной endpoint для проверки работоспособности API.
    """
    return {
        "message": "Ticket Platform API работает!",
        "version": "1.0.0",
        "status": "active"
    }

# Health check endpoint
@app.get("/health", summary="Health Check")
async def health_check():
    """
    Endpoint для проверки здоровья приложения.
    """
    try:
        # Проверяем подключение к базе данных
        db_status = "connected" if Database.client else "disconnected"
        
        # Проверяем сервис уведомлений
        redis_status = "connected" if notification_service.redis_client else "disconnected"
        
        return {
            "status": "healthy",
            "database": db_status,
            "redis": redis_status,
            "timestamp": "2025-12-04T00:00:00Z"
        }
    except Exception as e:
        logger.error(f"Ошибка health check: {e}")
        raise HTTPException(status_code=503, detail="Служба временно недоступна")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )