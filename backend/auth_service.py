from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import hashlib
import secrets
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import os

from auth_models import UserInDB, UserCreate, UserResponse, TokenData

# Настройки безопасности
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30



# Схема безопасности для Bearer токенов
security = HTTPBearer()

class AuthService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.users_collection = db.users

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Проверяет пароль против хеша"""
        try:
            stored_salt, stored_hash = hashed_password.split(':')
            return stored_hash == hashlib.pbkdf2_hmac('sha256', plain_password.encode(), stored_salt.encode(), 100000).hex()
        except:
            return False

    def get_password_hash(self, password: str) -> str:
        """Создает хеш пароля"""
        salt = secrets.token_hex(16)
        pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
        return f"{salt}:{pwd_hash.hex()}"

    def create_access_token(self, data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Создает JWT токен"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    async def get_user_by_email(self, email: str) -> Optional[UserInDB]:
        """Получает пользователя по email"""
        user_doc = await self.users_collection.find_one({"email": email})
        if user_doc:
            user_doc["id"] = str(user_doc["_id"])
            user_doc.pop("_id", None)
            return UserInDB(**user_doc)
        return None

    async def get_user_by_username(self, username: str) -> Optional[UserInDB]:
        """Получает пользователя по username"""
        user_doc = await self.users_collection.find_one({"username": username})
        if user_doc:
            user_doc["id"] = str(user_doc["_id"])
            user_doc.pop("_id", None)
            return UserInDB(**user_doc)
        return None

    async def create_user(self, user_data: UserCreate) -> UserInDB:
        """Создает нового пользователя"""
        # Проверяем, что email не используется
        existing_user = await self.get_user_by_email(user_data.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пользователь с таким email уже существует"
            )

        # Проверяем, что username не используется
        existing_username = await self.get_user_by_username(user_data.username)
        if existing_username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пользователь с таким именем уже существует"
            )

        # Создаем пользователя
        hashed_password = self.get_password_hash(user_data.password)
        user_doc = {
            "email": user_data.email,
            "username": user_data.username,
            "full_name": user_data.full_name,
            "hashed_password": hashed_password,
            "is_active": True,
            "is_support_staff": False,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }

        result = await self.users_collection.insert_one(user_doc)
        
        # Получаем созданного пользователя из БД
        created_user = await self.users_collection.find_one({"_id": result.inserted_id})
        created_user["id"] = str(created_user["_id"])
        created_user.pop("_id", None)

        return UserInDB(**created_user)

    async def authenticate_user(self, email: str, password: str) -> Optional[UserInDB]:
        """Аутентификация пользователя"""
        user = await self.get_user_by_email(email)
        if not user:
            return None
        if not self.verify_password(password, user.hashed_password):
            return None
        return user

    async def get_current_user(self, token: str) -> UserInDB:
        """Получает текущего пользователя из JWT токена"""
        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Не удалось проверить учетные данные",
            headers={"WWW-Authenticate": "Bearer"},
        )

        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            email: str = payload.get("sub")
            if email is None:
                raise credentials_exception
            token_data = TokenData(email=email)
        except JWTError:
            raise credentials_exception

        user = await self.get_user_by_email(token_data.email)
        if user is None:
            raise credentials_exception
        return user

    async def get_current_active_user(self, token: str) -> UserInDB:
        """Получает текущего активного пользователя"""
        current_user = await self.get_current_user(token)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Неактивный пользователь")
        return current_user

    def user_to_response(self, user: UserInDB) -> UserResponse:
        """Конвертирует пользователя в ответ (убирает пароль)"""
        return UserResponse(
            id=user.id or str(ObjectId()),
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            is_active=user.is_active,
            is_support_staff=user.is_support_staff,
            created_at=user.created_at
        )

# Создаем экземпляр сервиса
async def get_auth_service() -> AuthService:
    from database import Database
    return AuthService(Database.database)