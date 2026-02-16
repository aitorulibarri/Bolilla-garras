#!/usr/bin/env python3
"""
Stress Test para Bolilla Garras
Prueba la capacidad de respuesta de la aplicación bajo carga
"""
import requests
import time
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Configuración
BASE_URL = "https://bolilla-garras-kwz7.vercel.app"
NUM_REQUESTS = 500  # Número total de peticiones (simula tráfico intenso)
CONCURRENT_USERS = 100  # Usuarios simultáneos (100+ usuarios a la vez)

# Colores para terminal
GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
BLUE = '\033[94m'
RESET = '\033[0m'

class StressTest:
    def __init__(self):
        self.response_times = []
        self.successful_requests = 0
        self.failed_requests = 0
        self.status_codes = {}
        
    def make_request(self, request_num):
        """Hace una petición HTTP y mide el tiempo de respuesta"""
        start_time = time.time()
        try:
            response = requests.get(
                BASE_URL,
                timeout=30,
                headers={'User-Agent': f'StressTest-{request_num}'}
            )
            response_time = (time.time() - start_time) * 1000  # ms
            
            # Registrar estadísticas
            self.response_times.append(response_time)
            status = response.status_code
            self.status_codes[status] = self.status_codes.get(status, 0) + 1
            
            if response.status_code == 200:
                self.successful_requests += 1
                return {'success': True, 'time': response_time, 'status': status}
            else:
                self.failed_requests += 1
                return {'success': False, 'time': response_time, 'status': status}
                
        except requests.exceptions.Timeout:
            self.failed_requests += 1
            return {'success': False, 'time': None, 'error': 'Timeout'}
        except Exception as e:
            self.failed_requests += 1
            return {'success': False, 'time': None, 'error': str(e)}
    
    def run_test(self):
        """Ejecuta el stress test"""
        print(f"\n{BLUE}{'='*70}{RESET}")
        print(f"{BLUE}🔥 STRESS TEST - BOLILLA GARRAS 🔥{RESET}")
        print(f"{BLUE}{'='*70}{RESET}\n")
        
        print(f"📍 URL: {BASE_URL}")
        print(f"📊 Peticiones totales: {NUM_REQUESTS}")
        print(f"👥 Usuarios concurrentes: {CONCURRENT_USERS}")
        print(f"⏱️  Inicio: {datetime.now().strftime('%H:%M:%S')}\n")
        
        start_time = time.time()
        
        # Ejecutar peticiones concurrentes
        with ThreadPoolExecutor(max_workers=CONCURRENT_USERS) as executor:
            futures = [executor.submit(self.make_request, i) for i in range(NUM_REQUESTS)]
            
            # Mostrar progreso
            completed = 0
            for future in as_completed(futures):
                completed += 1
                if completed % 10 == 0:
                    print(f"  ✓ Completadas: {completed}/{NUM_REQUESTS}", end='\r')
        
        total_time = time.time() - start_time
        print(f"\n\n{GREEN}✅ Test completado en {total_time:.2f} segundos{RESET}\n")
        
        # Calcular estadísticas
        self.print_results(total_time)
    
    def print_results(self, total_time):
        """Imprime los resultados del test"""
        print(f"{BLUE}{'='*70}{RESET}")
        print(f"{BLUE}📊 RESULTADOS{RESET}")
        print(f"{BLUE}{'='*70}{RESET}\n")
        
        # Resumen general
        success_rate = (self.successful_requests / NUM_REQUESTS) * 100
        print(f"✅ Peticiones exitosas: {GREEN}{self.successful_requests}/{NUM_REQUESTS}{RESET} ({success_rate:.1f}%)")
        print(f"❌ Peticiones fallidas:  {RED}{self.failed_requests}/{NUM_REQUESTS}{RESET}")
        print()
        
        # Códigos de estado HTTP
        print(f"📋 Códigos de estado:")
        for status, count in sorted(self.status_codes.items()):
            color = GREEN if status == 200 else YELLOW if status < 400 else RED
            print(f"   {color}{status}{RESET}: {count} veces")
        print()
        
        # Tiempos de respuesta
        if self.response_times:
            avg_time = statistics.mean(self.response_times)
            min_time = min(self.response_times)
            max_time = max(self.response_times)
            median_time = statistics.median(self.response_times)
            
            print(f"⏱️  Tiempos de respuesta:")
            print(f"   Promedio:  {avg_time:.2f} ms")
            print(f"   Mínimo:    {min_time:.2f} ms")
            print(f"   Máximo:    {max_time:.2f} ms")
            print(f"   Mediana:   {median_time:.2f} ms")
            
            if len(self.response_times) > 1:
                stdev = statistics.stdev(self.response_times)
                print(f"   Desv. Est: {stdev:.2f} ms")
            print()
        
        # Rendimiento
        requests_per_second = NUM_REQUESTS / total_time
        print(f"🚀 Rendimiento:")
        print(f"   Peticiones/seg: {requests_per_second:.2f}")
        print(f"   Tiempo total:   {total_time:.2f} segundos")
        print()
        
        # Evaluación
        print(f"{BLUE}{'='*70}{RESET}")
        print(f"{BLUE}📈 EVALUACIÓN{RESET}")
        print(f"{BLUE}{'='*70}{RESET}\n")
        
        if success_rate == 100 and avg_time < 1000:
            print(f"{GREEN}🏆 EXCELENTE{RESET}")
            print(f"   La aplicación responde perfectamente bajo carga.")
        elif success_rate >= 95 and avg_time < 2000:
            print(f"{GREEN}✅ BUENO{RESET}")
            print(f"   La aplicación funciona bien bajo carga moderada.")
        elif success_rate >= 80:
            print(f"{YELLOW}⚠️  ACEPTABLE{RESET}")
            print(f"   La aplicación funciona pero puede mejorar.")
        else:
            print(f"{RED}❌ NECESITA MEJORAS{RESET}")
            print(f"   La aplicación tiene problemas bajo carga.")
        
        print()

if __name__ == "__main__":
    tester = StressTest()
    tester.run_test()
