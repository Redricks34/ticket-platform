from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection
from pymongo import IndexModel, ASCENDING, DESCENDING
from config import settings
import logging

logger = logging.getLogger(__name__)

class Database:
    client: AsyncIOMotorClient = None
    database: AsyncIOMotorDatabase = None
    
    @classmethod
    async def connect_db(cls):
        """Создать подключение к базе данных."""
        cls.client = AsyncIOMotorClient(settings.mongodb_url)
        cls.database = cls.client[settings.database_name]
        
        # Создание индексов для коллекции тикетов
        await cls.create_indexes()
        
        logger.info("Подключение к MongoDB установлено")
    
    @classmethod
    async def close_db(cls):
        """Закрыть подключение к базе данных."""
        cls.client.close()
        logger.info("Подключение к MongoDB закрыто")
    
    @classmethod
    async def create_indexes(cls):
        """Создать индексы для оптимизации запросов."""
        tickets_collection = cls.database.tickets
        
        # Индексы для быстрого поиска
        indexes = [
            IndexModel([("status", ASCENDING)]),
            IndexModel([("priority", ASCENDING)]),
            IndexModel([("category", ASCENDING)]),
            IndexModel([("reporter_email", ASCENDING)]),
            IndexModel([("assignee_id", ASCENDING)]),
            IndexModel([("created_at", DESCENDING)]),
            IndexModel([("updated_at", DESCENDING)]),
            # Составные индексы для сложных запросов
            IndexModel([("status", ASCENDING), ("priority", DESCENDING)]),
            IndexModel([("category", ASCENDING), ("created_at", DESCENDING)]),
            # Текстовый индекс для поиска по заголовку и описанию
            IndexModel([("title", "text"), ("description", "text")])
        ]
        
        await tickets_collection.create_indexes(indexes)
        
        # Создаем индексы для коллекции пользователей
        users_collection = cls.database.users
        users_indexes = [
            IndexModel([("email", ASCENDING)], unique=True),
            IndexModel([("username", ASCENDING)], unique=True),
            IndexModel([("created_at", DESCENDING)])
        ]
        await users_collection.create_indexes(users_indexes)
        
        logger.info("Индексы созданы успешно")
    
    @classmethod
    def get_collection(cls, name: str) -> AsyncIOMotorCollection:
        """Получить коллекцию по имени."""
        return cls.database[name]

# Функции для получения коллекций
def get_tickets_collection() -> AsyncIOMotorCollection:
    return Database.get_collection("tickets")

def get_users_collection() -> AsyncIOMotorCollection:
    return Database.get_collection("users")