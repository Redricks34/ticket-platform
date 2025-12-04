from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from typing import List, Optional
from datetime import datetime

from models import (
    TicketCreate, TicketUpdate, TicketResponse, 
    PaginatedResponse, TicketFilters, CommentCreate,
    TicketStatus, TicketPriority, TicketCategory
)
from services import TicketService
from notifications import notification_service

router = APIRouter(prefix="/tickets", tags=["Tickets"])

@router.post("/", response_model=TicketResponse, summary="Создать тикет")
async def create_ticket(ticket: TicketCreate):
    """
    Создать новый тикет в системе техподдержки.
    
    - **title**: Заголовок тикета (обязательно)
    - **description**: Описание проблемы (обязательно)
    - **priority**: Приоритет тикета (низкий, средний, высокий, критический)
    - **category**: Категория тикета
    - **reporter_email**: Email автора тикета
    - **reporter_name**: Имя автора тикета
    """
    return await TicketService.create_ticket(ticket)

@router.get("/", response_model=PaginatedResponse, summary="Получить список тикетов")
async def get_tickets(
    # Фильтры
    status: Optional[TicketStatus] = Query(None, description="Фильтр по статусу"),
    priority: Optional[TicketPriority] = Query(None, description="Фильтр по приоритету"),
    category: Optional[TicketCategory] = Query(None, description="Фильтр по категории"),
    assignee_id: Optional[str] = Query(None, description="Фильтр по исполнителю"),
    reporter_email: Optional[str] = Query(None, description="Фильтр по email автора"),
    created_from: Optional[datetime] = Query(None, description="Дата создания от"),
    created_to: Optional[datetime] = Query(None, description="Дата создания до"),
    search_text: Optional[str] = Query(None, description="Поиск по тексту"),
    
    # Пагинация
    page: int = Query(1, ge=1, description="Номер страницы"),
    page_size: int = Query(20, ge=1, le=100, description="Размер страницы")
):
    """
    Получить список тикетов с фильтрацией и пагинацией.
    
    Поддерживаются фильтры по статусу, приоритету, категории, исполнителю,
    автору, датам создания и текстовый поиск по заголовку и описанию.
    """
    filters = TicketFilters(
        status=status,
        priority=priority,
        category=category,
        assignee_id=assignee_id,
        reporter_email=reporter_email,
        created_from=created_from,
        created_to=created_to,
        search_text=search_text
    )
    
    return await TicketService.get_tickets(filters, page, page_size)

@router.get("/{ticket_id}", response_model=TicketResponse, summary="Получить тикет по ID")
async def get_ticket(ticket_id: str):
    """
    Получить подробную информацию о тикете по его ID.
    """
    return await TicketService.get_ticket(ticket_id)

@router.patch("/{ticket_id}", response_model=TicketResponse, summary="Обновить тикет")
async def update_ticket(ticket_id: str, update_data: TicketUpdate):
    """
    Обновить информацию о тикете.
    
    Можно обновить любые поля тикета, включая статус, приоритет,
    назначение исполнителя и другие параметры.
    """
    return await TicketService.update_ticket(ticket_id, update_data)

@router.post("/{ticket_id}/comments", response_model=TicketResponse, summary="Добавить комментарий")
async def add_comment(ticket_id: str, comment: CommentCreate):
    """
    Добавить комментарий к тикету.
    
    - **author_name**: Имя автора комментария
    - **author_email**: Email автора комментария
    - **content**: Содержание комментария
    """
    return await TicketService.add_comment(ticket_id, comment)

@router.delete("/{ticket_id}", summary="Удалить тикет")
async def delete_ticket(ticket_id: str):
    """
    Удалить тикет из системы.
    
    **Внимание**: Это действие необратимо!
    """
    await TicketService.delete_ticket(ticket_id)
    return {"message": "Тикет успешно удален"}

# WebSocket endpoint для уведомлений в реальном времени
@router.websocket("/ws/notifications")
async def websocket_notifications(websocket: WebSocket):
    """
    WebSocket для получения уведомлений о тикетах в реальном времени.
    
    Клиенты могут подключиться к этому endpoint'у для получения
    уведомлений о создании, обновлении и закрытии тикетов.
    """
    await websocket.accept()
    notification_service.add_subscriber("ticket_events", websocket)
    
    try:
        # Отправляем приветственное сообщение
        await websocket.send_text('{"event": "connected", "message": "Подключено к уведомлениям о тикетах"}')
        
        # Поддерживаем соединение активным
        while True:
            # Ожидаем любые сообщения от клиента (например, ping)
            data = await websocket.receive_text()
            
            # Можем отвечать на ping сообщения
            if data == "ping":
                await websocket.send_text("pong")
                
    except WebSocketDisconnect:
        notification_service.remove_subscriber("ticket_events", websocket)
    except Exception as e:
        notification_service.remove_subscriber("ticket_events", websocket)
        await websocket.close()

# Дополнительные endpoint'ы для аналитики
@router.get("/stats/summary", summary="Статистика тикетов")
async def get_ticket_stats():
    """
    Получить общую статистику по тикетам.
    """
    # Получаем все тикеты для подсчета статистики
    all_tickets = await TicketService.get_tickets(TicketFilters(), page=1, page_size=1000)
    
    # Подсчитываем статистику
    stats = {
        "total": all_tickets.total,
        "by_status": {},
        "by_priority": {},
        "by_category": {}
    }
    
    for ticket in all_tickets.tickets:
        # По статусу
        status_key = ticket.status.value
        stats["by_status"][status_key] = stats["by_status"].get(status_key, 0) + 1
        
        # По приоритету
        priority_key = ticket.priority.value
        stats["by_priority"][priority_key] = stats["by_priority"].get(priority_key, 0) + 1
        
        # По категории
        category_key = ticket.category.value
        stats["by_category"][category_key] = stats["by_category"].get(category_key, 0) + 1
    
    return stats

# Маршруты для сообщений
@router.get("/{ticket_id}/messages", response_model=List[dict])
async def get_ticket_messages(ticket_id: str):
    """Получить все сообщения для тикета."""
    try:
        from message_service import message_service
        messages = await message_service.get_messages_by_ticket(ticket_id)
        return [message.model_dump() for message in messages]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{ticket_id}/messages")
async def create_ticket_message(ticket_id: str, message_data: dict):
    """Создать новое сообщение в тикете."""
    try:
        from message_service import message_service
        from models import MessageCreate
        
        message_create = MessageCreate(**message_data)
        message = await message_service.create_message(ticket_id, message_create)
        
        # Отправляем уведомление через WebSocket
        await notification_service.publish_ticket_event("message_added", {
            "ticket_id": ticket_id,
            "message": message.model_dump()
        })
        
        return message.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{ticket_id}/unread-count")
async def get_unread_messages_count(ticket_id: str, user_email: str):
    """Получить количество непрочитанных сообщений для пользователя."""
    try:
        from message_service import message_service
        count = await message_service.get_unread_count(ticket_id, user_email)
        return {"count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))