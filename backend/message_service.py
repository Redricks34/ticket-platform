from typing import List, Optional
from database import Database
from models import Message, MessageCreate
from support_service import support_service
import logging

logger = logging.getLogger(__name__)

class MessageService:
    """Сервис для работы с сообщениями в тикетах"""
    
    @staticmethod
    async def create_message(ticket_id: str, message_data: MessageCreate) -> Message:
        """Создает новое сообщение в тикете"""
        try:
            # Проверяем, является ли автор сотрудником техподдержки
            is_support = support_service.is_support_user(message_data.author_email)
            
            message_dict = {
                "ticket_id": ticket_id,
                "content": message_data.content,
                "author_email": message_data.author_email,
                "author_name": message_data.author_name,
                "is_support": is_support
            }
            
            messages_collection = Database.get_collection("messages")
            result = await messages_collection.insert_one(message_dict)
            message_dict["_id"] = str(result.inserted_id)
            
            logger.info(f"Создано сообщение в тикете {ticket_id} от {message_data.author_email}")
            return Message(**message_dict)
            
        except Exception as e:
            logger.error(f"Ошибка создания сообщения: {e}")
            raise
    
    @staticmethod
    async def get_messages_by_ticket(ticket_id: str) -> List[Message]:
        """Получает все сообщения для тикета"""
        try:
            messages_collection = Database.get_collection("messages")
            cursor = messages_collection.find(
                {"ticket_id": ticket_id}
            ).sort("created_at", 1)
            
            messages = []
            async for message_doc in cursor:
                message_doc["_id"] = str(message_doc["_id"])
                messages.append(Message(**message_doc))
            
            return messages
            
        except Exception as e:
            logger.error(f"Ошибка получения сообщений для тикета {ticket_id}: {e}")
            raise
    
    @staticmethod
    async def get_unread_count(ticket_id: str, user_email: str) -> int:
        """Получает количество непрочитанных сообщений для пользователя"""
        try:
            messages_collection = Database.get_collection("messages")
            read_status_collection = Database.get_collection("read_status")
            
            # Получаем последнее время прочтения пользователем
            user_read = await read_status_collection.find_one({
                "ticket_id": ticket_id,
                "user_email": user_email
            })
            
            # Если нет записи о прочтении, считаем все сообщения непрочитанными
            if not user_read:
                return await messages_collection.count_documents({
                    "ticket_id": ticket_id,
                    "author_email": {"$ne": user_email}
                })
            
            # Считаем сообщения после последнего прочтения
            return await messages_collection.count_documents({
                "ticket_id": ticket_id,
                "author_email": {"$ne": user_email},
                "created_at": {"$gt": user_read["last_read_at"]}
            })
            
        except Exception as e:
            logger.error(f"Ошибка подсчета непрочитанных сообщений: {e}")
            return 0
    
    @staticmethod
    async def mark_as_read(ticket_id: str, user_email: str):
        """Отмечает сообщения как прочитанные"""
        try:
            from datetime import datetime
            read_status_collection = Database.get_collection("read_status")
            await read_status_collection.update_one(
                {"ticket_id": ticket_id, "user_email": user_email},
                {"$set": {"last_read_at": datetime.utcnow()}},
                upsert=True
            )
        except Exception as e:
            logger.error(f"Ошибка отметки сообщений как прочитанные: {e}")

# Глобальный экземпляр сервиса
message_service = MessageService()