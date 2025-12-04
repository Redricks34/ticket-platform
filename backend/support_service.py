import os
from typing import List, Set

class SupportService:
    """Сервис для работы с сотрудниками техподдержки"""
    
    def __init__(self):
        self._support_emails: Set[str] = set()
        self._load_support_emails()
    
    def _load_support_emails(self):
        """Загружает список email'ов техподдержки из файла"""
        try:
            support_file = os.path.join(os.path.dirname(__file__), 'support.txt')
            if os.path.exists(support_file):
                with open(support_file, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                    if content:
                        # Поддерживаем и запятые, и новые строки
                        emails = [email.strip().lower() for email in content.replace('\n', ',').split(',')]
                        self._support_emails = set(filter(None, emails))
        except Exception as e:
            print(f"Ошибка загрузки файла техподдержки: {e}")
    
    def is_support_user(self, email: str) -> bool:
        """Проверяет, является ли пользователь сотрудником техподдержки"""
        return email.lower().strip() in self._support_emails
    
    def get_support_emails(self) -> List[str]:
        """Возвращает список всех email'ов техподдержки"""
        return list(self._support_emails)
    
    def reload_support_emails(self):
        """Перезагружает список email'ов техподдержки"""
        self._support_emails.clear()
        self._load_support_emails()

# Глобальный экземпляр сервиса
support_service = SupportService()