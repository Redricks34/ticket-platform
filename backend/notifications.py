import redis.asyncio as redis
import json
from typing import Dict, List
from config import settings
from models import TicketNotification
import logging

logger = logging.getLogger(__name__)

class NotificationService:
    def __init__(self):
        self.redis_client = None
        self.subscribers: Dict[str, List] = {}
    
    async def connect(self):
        """Подключиться к Redis для уведомлений в реальном времени."""
        try:
            self.redis_client = redis.from_url(settings.redis_url)
            await self.redis_client.ping()
            logger.info("Подключение к Redis установлено")
        except Exception as e:
            logger.warning(f"Не удалось подключиться к Redis: {e}")
            self.redis_client = None
    
    async def disconnect(self):
        """Отключиться от Redis."""
        if self.redis_client:
            await self.redis_client.close()
            logger.info("Подключение к Redis закрыто")
    
    async def publish_ticket_event(self, event: str, ticket_data: dict):
        """Опубликовать событие тикета для других сервисов."""
        notification = TicketNotification(
            event=event,
            ticket_id=str(ticket_data.get("_id", ticket_data.get("id"))),
            ticket=ticket_data
        )
        
        message = notification.model_dump_json()
        
        # Публикация в Redis (если доступен)
        if self.redis_client:
            try:
                await self.redis_client.publish("ticket_events", message)
                logger.info(f"Событие {event} опубликовано для тикета {notification.ticket_id}")
            except Exception as e:
                logger.error(f"Ошибка публикации в Redis: {e}")
        
        # Уведомление WebSocket подключений
        await self.notify_websocket_clients("ticket_events", message)
    
    async def notify_websocket_clients(self, channel: str, message: str):
        """Отправить уведомления всем подключенным WebSocket клиентам."""
        if channel in self.subscribers:
            disconnected_clients = []
            for websocket in self.subscribers[channel]:
                try:
                    await websocket.send_text(message)
                except Exception as e:
                    logger.warning(f"Ошибка отправки уведомления клиенту: {e}")
                    disconnected_clients.append(websocket)
            
            # Удалить отключенных клиентов
            for client in disconnected_clients:
                self.subscribers[channel].remove(client)
    
    def add_subscriber(self, channel: str, websocket):
        """Добавить WebSocket подписчика."""
        if channel not in self.subscribers:
            self.subscribers[channel] = []
        self.subscribers[channel].append(websocket)
        logger.info(f"Добавлен подписчик на канал {channel}")
    
    def remove_subscriber(self, channel: str, websocket):
        """Удалить WebSocket подписчика."""
        if channel in self.subscribers and websocket in self.subscribers[channel]:
            self.subscribers[channel].remove(websocket)
            logger.info(f"Удален подписчик с канала {channel}")

# Глобальный экземпляр сервиса уведомлений
notification_service = NotificationService()