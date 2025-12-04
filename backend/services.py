from fastapi import HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from models import (
    Ticket, TicketCreate, TicketUpdate, TicketFilters, 
    TicketResponse, PaginatedResponse, Comment, CommentCreate,
    TicketStatus
)
from database import get_tickets_collection, get_messages_collection
from notifications import notification_service

logger = logging.getLogger(__name__)

class TicketService:
    
    @staticmethod
    async def create_ticket(ticket_data: TicketCreate) -> TicketResponse:
        """Создать новый тикет."""
        collection = get_tickets_collection()
        
        # Создаем тикет
        ticket_dict = ticket_data.model_dump()
        ticket_dict["status"] = "открыт"
        ticket_dict["comments"] = []
        ticket_dict["created_at"] = datetime.utcnow()
        ticket_dict["updated_at"] = datetime.utcnow()
        
        # Сохраняем в базе данных
        result = await collection.insert_one(ticket_dict)
        ticket_dict["_id"] = result.inserted_id
        
        # Конвертируем в ответ
        response = TicketService._ticket_to_response(ticket_dict)
        
        # Отправляем уведомление о создании
        await notification_service.publish_ticket_event("created", response.model_dump())
        
        logger.info(f"Создан тикет с ID: {result.inserted_id}")
        return response
    
    @staticmethod
    async def get_ticket(ticket_id: str) -> TicketResponse:
        """Получить тикет по ID."""
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Некорректный ID тикета")
        
        collection = get_tickets_collection()
        ticket = await collection.find_one({"_id": ObjectId(ticket_id)})
        
        if not ticket:
            raise HTTPException(status_code=404, detail="Тикет не найден")
        
        return TicketService._ticket_to_response(ticket)
    
    @staticmethod
    async def update_ticket(ticket_id: str, update_data: TicketUpdate) -> TicketResponse:
        """Обновить тикет."""
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Некорректный ID тикета")
        
        collection = get_tickets_collection()
        
        # Подготавливаем данные для обновления
        update_dict = {}
        for field, value in update_data.model_dump(exclude_unset=True).items():
            if value is not None:
                update_dict[field] = value
        
        if not update_dict:
            raise HTTPException(status_code=400, detail="Нет данных для обновления")
        
        # Обновляем время изменения
        update_dict["updated_at"] = datetime.utcnow()
        
        # Если статус изменился на "закрыт" или "решен", устанавливаем время закрытия
        if update_dict.get("status") in [TicketStatus.CLOSED, TicketStatus.RESOLVED]:
            update_dict["closed_at"] = datetime.utcnow()
        
        # Обновляем тикет
        result = await collection.find_one_and_update(
            {"_id": ObjectId(ticket_id)},
            {"$set": update_dict},
            return_document=True
        )
        
        if not result:
            raise HTTPException(status_code=404, detail="Тикет не найден")
        
        response = TicketService._ticket_to_response(result)
        
        # Отправляем уведомление об обновлении
        await notification_service.publish_ticket_event("updated", response.model_dump())
        
        logger.info(f"Обновлен тикет с ID: {ticket_id}")
        return response
    
    @staticmethod
    async def get_tickets(
        filters: TicketFilters,
        page: int = 1,
        page_size: int = 20
    ) -> PaginatedResponse:
        """Получить список тикетов с фильтрацией и пагинацией."""
        collection = get_tickets_collection()
        
        # Строим запрос на основе фильтров
        query = TicketService._build_query(filters)
        
        # Подсчитываем общее количество
        total = await collection.count_documents(query)
        
        # Вычисляем пагинацию
        skip = (page - 1) * page_size
        total_pages = (total + page_size - 1) // page_size
        
        # Получаем тикеты с сортировкой по дате создания (новые первые)
        cursor = collection.find(query).sort("created_at", -1).skip(skip).limit(page_size)
        tickets = await cursor.to_list(length=page_size)
        
        # Конвертируем в ответы
        ticket_responses = [TicketService._ticket_to_response(ticket) for ticket in tickets]
        
        return PaginatedResponse(
            tickets=ticket_responses,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )
    
    @staticmethod
    async def add_comment(ticket_id: str, comment_data: CommentCreate) -> TicketResponse:
        """Добавить комментарий к тикету."""
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Некорректный ID тикета")
        
        collection = get_tickets_collection()
        
        # Создаем комментарий
        comment_dict = comment_data.model_dump()
        comment_dict["_id"] = str(ObjectId())
        comment_dict["created_at"] = datetime.utcnow()
        
        # Добавляем комментарий к тикету
        result = await collection.find_one_and_update(
            {"_id": ObjectId(ticket_id)},
            {
                "$push": {"comments": comment_dict},
                "$set": {"updated_at": datetime.utcnow()}
            },
            return_document=True
        )
        
        if not result:
            raise HTTPException(status_code=404, detail="Тикет не найден")
        
        response = TicketService._ticket_to_response(result)
        
        # Отправляем уведомление о добавлении комментария
        await notification_service.publish_ticket_event("comment_added", response.model_dump())
        
        logger.info(f"Добавлен комментарий к тикету с ID: {ticket_id}")
        return response
    
    @staticmethod
    async def delete_ticket(ticket_id: str) -> bool:
        """Удалить тикет."""
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Некорректный ID тикета")
        
        collection = get_tickets_collection()
        result = await collection.delete_one({"_id": ObjectId(ticket_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Тикет не найден")
        
        logger.info(f"Удален тикет с ID: {ticket_id}")
        return True
    
    @staticmethod
    def _ticket_to_response(ticket: Dict[str, Any]) -> TicketResponse:
        """Конвертировать тикет из базы данных в ответ API."""
        # Преобразование старого статуса для обратной совместимости
        status = ticket["status"]
        if status == "в_процессе":
            status = "в работе"
        
        return TicketResponse(
            id=str(ticket["_id"]),
            title=ticket["title"],
            description=ticket["description"],
            status=status,
            priority=ticket["priority"],
            category=ticket["category"],
            reporter_email=ticket["reporter_email"],
            reporter_name=ticket["reporter_name"],
            assignee_id=ticket.get("assignee_id"),
            assignee_name=ticket.get("assignee_name"),
            comments_count=len(ticket.get("comments", [])),
            created_at=ticket["created_at"],
            updated_at=ticket["updated_at"],
            closed_at=ticket.get("closed_at")
        )
    
    @staticmethod
    def _build_query(filters: TicketFilters) -> Dict[str, Any]:
        """Построить MongoDB запрос на основе фильтров."""
        query = {}
        
        if filters.status:
            query["status"] = filters.status
        
        if filters.priority:
            query["priority"] = filters.priority
        
        if filters.category:
            query["category"] = filters.category
        
        if filters.assignee_id:
            query["assignee_id"] = filters.assignee_id
        
        if filters.reporter_email:
            query["reporter_email"] = filters.reporter_email
        
        # Фильтр по датам
        date_filter = {}
        if filters.created_from:
            date_filter["$gte"] = filters.created_from
        if filters.created_to:
            date_filter["$lte"] = filters.created_to
        
        if date_filter:
            query["created_at"] = date_filter
        
        # Текстовый поиск
        if filters.search_text:
            query["$text"] = {"$search": filters.search_text}
        
        return query
    
    @staticmethod
    async def assign_ticket(ticket_id: str, assignee_email: str, assignee_name: str) -> TicketResponse:
        """Назначить тикет сотруднику техподдержки."""
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Некорректный ID тикета")
        
        collection = get_tickets_collection()
        
        # Проверяем, что тикет существует и не назначен
        ticket = await collection.find_one({"_id": ObjectId(ticket_id)})
        if not ticket:
            raise HTTPException(status_code=404, detail="Тикет не найден")
        
        if ticket.get("assignee_id"):
            raise HTTPException(status_code=400, detail="Тикет уже назначен")
        
        # Назначаем тикет
        update_dict = {
            "assignee_id": assignee_email,  # Используем email как ID
            "assignee_name": assignee_name,
            "status": "в работе",
            "updated_at": datetime.utcnow()
        }
        
        result = await collection.find_one_and_update(
            {"_id": ObjectId(ticket_id)},
            {"$set": update_dict},
            return_document=True
        )
        
        response = TicketService._ticket_to_response(result)
        
        # Отправляем уведомление о назначении
        await notification_service.publish_ticket_event("assigned", response.model_dump())
        
        logger.info(f"Тикет {ticket_id} назначен пользователю {assignee_email}")
        return response
    
    @staticmethod
    async def get_assigned_tickets(assignee_email: str, page: int = 1, page_size: int = 20) -> PaginatedResponse:
        """Получить активные тикеты, назначенные конкретному сотруднику техподдержки (исключая закрытые)."""
        collection = get_tickets_collection()
        
        # Фильтр для активных тикетов назначенных пользователю
        query = {
            "assignee_id": assignee_email,
            "status": {"$nin": ["закрыт", "решен"]}  # Исключаем закрытые и решенные тикеты
        }
        
        # Подсчитываем общее количество
        total = await collection.count_documents(query)
        
        # Вычисляем пагинацию
        skip = (page - 1) * page_size
        total_pages = (total + page_size - 1) // page_size
        
        # Получаем тикеты
        cursor = collection.find(query).sort("created_at", -1).skip(skip).limit(page_size)
        tickets = []
        
        async for ticket_data in cursor:
            ticket_data["_id"] = str(ticket_data["_id"])
            ticket_data["id"] = ticket_data["_id"]
            
            # Преобразование старого статуса для обратной совместимости
            if ticket_data["status"] == "в_процессе":
                ticket_data["status"] = "в работе"
            
            # Подсчитываем количество комментариев
            messages_collection = get_messages_collection()
            comments_count = await messages_collection.count_documents({"ticket_id": ticket_data["id"]})
            ticket_data["comments_count"] = comments_count
            
            tickets.append(TicketResponse(**ticket_data))
        
        return PaginatedResponse(
            tickets=tickets,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )
    
    @staticmethod
    async def get_unassigned_tickets(page: int = 1, page_size: int = 20) -> PaginatedResponse:
        """Получить неназначенные активные тикеты для техподдержки (исключая закрытые)."""
        collection = get_tickets_collection()
        
        query = {
            "assignee_id": {"$exists": False},
            "status": {"$nin": ["закрыт", "решен"]}  # Исключаем закрытые и решенные тикеты
        }
        
        # Подсчитываем общее количество
        total = await collection.count_documents(query)
        
        # Вычисляем пагинацию
        skip = (page - 1) * page_size
        total_pages = (total + page_size - 1) // page_size
        
        # Получаем тикеты
        cursor = collection.find(query).sort("created_at", -1).skip(skip).limit(page_size)
        tickets = []
        
        async for ticket_doc in cursor:
            tickets.append(TicketService._ticket_to_response(ticket_doc))
        
        return PaginatedResponse(
            tickets=tickets,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )