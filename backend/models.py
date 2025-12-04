from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Annotated
from datetime import datetime
from enum import Enum
from bson import ObjectId
import re

class TicketStatus(str, Enum):
    OPEN = "открыт"
    IN_PROGRESS = "в_процессе"
    CLOSED = "закрыт"
    RESOLVED = "решен"

class TicketPriority(str, Enum):
    LOW = "низкий"
    MEDIUM = "средний"
    HIGH = "высокий"
    CRITICAL = "критический"

class TicketCategory(str, Enum):
    TECHNICAL = "техническая"
    BILLING = "биллинг"
    GENERAL = "общий"
    BUG_REPORT = "баг_репорт"
    FEATURE_REQUEST = "запрос_функции"

class TicketBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    priority: TicketPriority = TicketPriority.MEDIUM
    category: TicketCategory = TicketCategory.GENERAL
    reporter_email: str = Field(..., min_length=1)
    reporter_name: str = Field(..., min_length=1, max_length=100)

    @field_validator('reporter_email')
    @classmethod
    def validate_email(cls, v):
        if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
            raise ValueError('Invalid email format')
        return v

class TicketCreate(TicketBase):
    pass

class TicketUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    category: Optional[TicketCategory] = None
    assignee_id: Optional[str] = None

class Comment(BaseModel):
    id: str = Field(default="", alias="_id")
    author_name: str
    author_email: str
    content: str = Field(..., min_length=1, max_length=1000)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator('author_email')
    @classmethod
    def validate_email(cls, v):
        if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
            raise ValueError('Invalid email format')
        return v
    
    model_config = {"populate_by_name": True}

class CommentCreate(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=100)
    author_email: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1, max_length=1000)

    @field_validator('author_email')
    @classmethod
    def validate_email(cls, v):
        if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
            raise ValueError('Invalid email format')
        return v

class Ticket(TicketBase):
    id: str = Field(default="", alias="_id")
    status: TicketStatus = TicketStatus.OPEN
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    comments: List[Comment] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}

class TicketFilters(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    category: Optional[TicketCategory] = None
    assignee_id: Optional[str] = None
    reporter_email: Optional[str] = None
    created_from: Optional[datetime] = None
    created_to: Optional[datetime] = None
    search_text: Optional[str] = None

class TicketResponse(BaseModel):
    id: str
    title: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    category: TicketCategory
    reporter_email: str
    reporter_name: str
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    comments_count: int
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None

class PaginatedResponse(BaseModel):
    tickets: List[TicketResponse]
    total: int
    page: int
    page_size: int
    total_pages: int

class TicketNotification(BaseModel):
    event: str  # "created", "updated", "closed", "comment_added"
    ticket_id: str
    ticket: TicketResponse
    timestamp: datetime = Field(default_factory=datetime.utcnow)