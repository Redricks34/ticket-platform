import http.server
import socketserver
import webbrowser
import os
from pathlib import Path

# Порт для frontend
PORT = 3000

# Путь к frontend файлам
FRONTEND_DIR = Path(__file__).parent

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)
    
    def end_headers(self):
        # Добавляем CORS заголовки для работы с backend
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

def start_server():
    """Запуск development сервера для frontend"""
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"🚀 Frontend server запущен на http://localhost:{PORT}")
        print(f"📁 Обслуживает файлы из: {FRONTEND_DIR}")
        print("💡 Убедитесь, что backend запущен на http://localhost:8000")
        print("🔄 Для остановки нажмите Ctrl+C")
        
        # Автоматически открываем браузер
        try:
            webbrowser.open(f'http://localhost:{PORT}')
        except:
            pass
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Сервер остановлен")

if __name__ == "__main__":
    start_server()