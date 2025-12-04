from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List
import logging

try:
    from models import TicketResponse, PaginatedResponse, MessageCreate, Message
    from services import TicketService
    from support_service import support_service
    from auth_service import AuthService, get_auth_service
except ImportError as e:
    print(f"Import error in support_routes: {e}")
    raise

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["Support"])
security = HTTPBearer()

async def get_current_support_user(
    token: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
):
    """Проверяет, что пользователь является сотрудником техподдержки."""
    try:
        logger.info(f"Проверка токена поддержки: {token.credentials[:20]}...")
        
        # Используем get_current_user вместо несуществующего verify_access_token
        user = await auth_service.get_current_user(token.credentials)
        logger.info(f"Извлечен пользователь из токена: {user.email}")
        
        is_support = support_service.is_support_user(user.email)
        logger.info(f"Является ли пользователь поддержкой: {is_support}")
        
        if not is_support:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Доступ запрещен. Требуются права техподдержки."
            )
        
        logger.info(f"Пользователь поддержки проверен успешно: {user.email}")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ошибка при проверке токена поддержки: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен"
        )

@router.get("/tickets/unassigned", response_model=PaginatedResponse)
async def get_unassigned_tickets(
    page: int = 1,
    page_size: int = 20,
    current_user = Depends(get_current_support_user)
):
    """Получить неназначенные тикеты для техподдержки."""
    return await TicketService.get_unassigned_tickets(page, page_size)

@router.get("/tickets/assigned", response_model=PaginatedResponse)
async def get_assigned_tickets(
    page: int = 1,
    page_size: int = 20,
    current_user = Depends(get_current_support_user)
):
    """Получить тикеты, назначенные текущему сотруднику техподдержки."""
    return await TicketService.get_assigned_tickets(current_user.email, page, page_size)

@router.post("/tickets/{ticket_id}/assign", response_model=TicketResponse)
async def assign_ticket(
    ticket_id: str,
    current_user = Depends(get_current_support_user)
):
    """Принять тикет (назначить себе)."""
    return await TicketService.assign_ticket(
        ticket_id, 
        current_user.email, 
        current_user.full_name
    )

@router.get("/tickets/{ticket_id}/messages")
async def get_ticket_messages(
    ticket_id: str,
    current_user = Depends(get_current_support_user)
):
    """Получить все сообщения для тикета."""
    try:
        from message_service import message_service
        messages = await message_service.get_messages_by_ticket(ticket_id)
        return [message.model_dump() for message in messages]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tickets/{ticket_id}/messages")
async def create_message(
    ticket_id: str,
    message_data: dict,
    current_user = Depends(get_current_support_user)
):
    """Создать новое сообщение в тикете."""
    try:
        from message_service import message_service
        from models import MessageCreate
        
        # Проверяем, что сообщение от текущего пользователя
        if message_data.get("author_email") != current_user.email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Можно отправлять сообщения только от своего имени"
            )
        
        message_create = MessageCreate(**message_data)
        message = await message_service.create_message(ticket_id, message_create)
        return message.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tickets/{ticket_id}/mark-read")
async def mark_messages_as_read(
    ticket_id: str,
    current_user = Depends(get_current_support_user)
):
    """Отметить сообщения тикета как прочитанные."""
    try:
        from message_service import message_service
        await message_service.mark_as_read(ticket_id, current_user.email)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/check")
async def check_support_status(
    current_user = Depends(get_current_support_user)
):
    """Проверить статус техподдержки пользователя."""
    return {
        "is_support": True,
        "user": {
            "email": current_user.email,
            "full_name": current_user.full_name
        }
    }