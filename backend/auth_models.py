from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional
from datetime import datetime
from bson import ObjectId
import re

# Модель пользователя для базы данных
class UserInDB(BaseModel):
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )
    
    id: Optional[str] = Field(default=None)
    email: str = Field(..., description="Email пользователя")
    username: str = Field(..., description="Имя пользователя")
    full_name: str = Field(..., description="Полное имя")
    hashed_password: str = Field(..., description="Хешированный пароль")
    is_active: bool = Field(default=True, description="Активен ли пользователь")
    is_support_staff: bool = Field(default=False, description="Является ли сотрудником поддержки")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, v):
            raise ValueError('Неверный формат email')
        return v.lower()

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError('Имя пользователя должно содержать минимум 3 символа')
        if not re.match(r'^[a-zA-Z0-9_]+$', v):
            raise ValueError('Имя пользователя может содержать только буквы, цифры и подчеркивание')
        return v

# Модель для регистрации пользователя
class UserCreate(BaseModel):
    email: str = Field(..., description="Email пользователя")
    username: str = Field(..., description="Имя пользователя")
    full_name: str = Field(..., description="Полное имя")
    password: str = Field(..., min_length=6, description="Пароль (минимум 6 символов)")

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, v):
            raise ValueError('Неверный формат email')
        return v.lower()

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError('Пароль должен содержать минимум 6 символов')
        return v

# Модель для входа пользователя
class UserLogin(BaseModel):
    email: str = Field(..., description="Email пользователя")
    password: str = Field(..., description="Пароль")

# Модель пользователя для ответа (без пароля)
class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str
    is_active: bool
    is_support_staff: bool
    created_at: datetime

# Модель токена
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

# Модель данных токена
class TokenData(BaseModel):
    email: Optional[str] = None

# Модель для обновления профиля
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if len(v) < 3:
                raise ValueError('Имя пользователя должно содержать минимум 3 символа')
            if not re.match(r'^[a-zA-Z0-9_]+$', v):
                raise ValueError('Имя пользователя может содержать только буквы, цифры и подчеркивание')
        return v