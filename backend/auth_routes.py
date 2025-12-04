from datetime import timedelta, datetime
from fastapi import APIRouter, HTTPException, status, Depends, Header
from fastapi.security import HTTPAuthorizationCredentials
from bson import ObjectId
from typing import Optional

from auth_models import UserCreate, UserLogin, Token, UserResponse, UserUpdate
from auth_service import get_auth_service, AuthService, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/auth", tags=["Authentication"])

def get_token_from_header(authorization: Optional[str] = Header(None)) -> str:
    """Извлекает токен из заголовка Authorization"""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен авторизации не предоставлен",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный формат токена",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return authorization.split(" ")[1]

@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: UserCreate,
    auth_service: AuthService = Depends(get_auth_service)
):
    """Регистрация нового пользователя"""
    try:
        # Создаем пользователя
        user = await auth_service.create_user(user_data)
        
        # Создаем токен доступа
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = auth_service.create_access_token(
            data={"sub": user.email}, expires_delta=access_token_expires
        )
        
        user_response = auth_service.user_to_response(user)
        
        return Token(
            access_token=access_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=user_response
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка при регистрации: {str(e)}"
        )

@router.post("/login", response_model=Token)
async def login_user(
    user_credentials: UserLogin,
    auth_service: AuthService = Depends(get_auth_service)
):
    """Вход пользователя в систему"""
    user = await auth_service.authenticate_user(
        user_credentials.email, 
        user_credentials.password
    )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Аккаунт деактивирован"
        )
    
    # Создаем токен доступа
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth_service.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    user_response = auth_service.user_to_response(user)
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_response
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    token: str = Depends(get_token_from_header),
    auth_service: AuthService = Depends(get_auth_service)
):
    """Получение профиля текущего пользователя"""
    current_user = await auth_service.get_current_active_user(token)
    return auth_service.user_to_response(current_user)

@router.put("/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    token: str = Depends(get_token_from_header),
    auth_service: AuthService = Depends(get_auth_service)
):
    """Обновление профиля текущего пользователя"""
    current_user = await auth_service.get_current_active_user(token)
    try:
        # Проверяем, что новое имя пользователя не занято (если оно изменяется)
        if user_update.username and user_update.username != current_user.username:
            existing_user = await auth_service.get_user_by_username(user_update.username)
            if existing_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Пользователь с таким именем уже существует"
                )

        # Обновляем только переданные поля
        update_data = {}
        if user_update.full_name is not None:
            update_data["full_name"] = user_update.full_name
        if user_update.username is not None:
            update_data["username"] = user_update.username
        
        if update_data:
            update_data["updated_at"] = datetime.utcnow()
            await auth_service.users_collection.update_one(
                {"_id": ObjectId(current_user.id)},
                {"$set": update_data}
            )
            
            # Получаем обновленного пользователя
            updated_user = await auth_service.get_user_by_email(current_user.email)
            return auth_service.user_to_response(updated_user)
        
        return auth_service.user_to_response(current_user)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка при обновлении профиля: {str(e)}"
        )