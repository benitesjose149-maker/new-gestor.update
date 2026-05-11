import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { NotificationService } from '../shared/notification.service';
import { API_URL } from '../api-config';
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject: BehaviorSubject<any>;
  public currentUser: Observable<any>;
  private autoRefreshStarted = false;
  private refreshInterval: any = null;

  private readonly permissionLabels: Record<string, string> = {
    dashboard: 'Panel Principal',
    planilla: 'Planilla',
    movimientos: 'Movimientos',
    finanzas: 'Finanzas',
    empleados: 'Empleados',
    archivados: 'Archivados',
    historial: 'Pagos',
    vacaciones: 'Vacaciones',
    asistencia: 'Asistencia'
  };
  constructor(
    private router: Router,
    private notificationService: NotificationService,
    private http: HttpClient
  ) {
    const savedUser = sessionStorage.getItem('currentUser');
    this.currentUserSubject = new BehaviorSubject<any>(savedUser ? JSON.parse(savedUser) : null);
    this.currentUser = this.currentUserSubject.asObservable();
    if (savedUser) {
      this.startAutoRefresh();
    }
  }
  public get currentUserValue(): any {
    return this.currentUserSubject.value;
  }
  isLoggedIn(): boolean {
    return !!this.currentUserValue;
  }
  login(user: any) {
    sessionStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUserSubject.next(user);
    this.startAutoRefresh();
  }
  logout() {
    sessionStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      this.autoRefreshStarted = false;
    }
    this.router.navigate(['/login']);
  }
  async refreshPermissions() {
    const user = this.currentUserValue;
    if (!user || !user.email) return;
    try {
      const url = `${API_URL}/api/auth/me/${user.email}?t=${new Date().getTime()}`;
      const data: any = await firstValueFrom(this.http.get(url));
      if (data && data.success && data.user) {
        const newPerms = data.user.permissions;
        const oldPerms = user.permissions || {};

        let hasChanged = false;
        const newSections: string[] = [];
        const removedSections: string[] = [];

        for (const key of Object.keys(this.permissionLabels)) {
          const hadAccess = !!oldPerms[key];
          const hasAccess = !!newPerms[key];
          if (hadAccess !== hasAccess) {
            hasChanged = true;
            if (hasAccess) newSections.push(this.permissionLabels[key]);
            else removedSections.push(this.permissionLabels[key]);
          }
        }

        if (hasChanged || user.rol !== data.user.rol) {
          console.log('Permisos actualizados detectados.');

          const updatedUser = {
            ...user,
            permissions: newPerms,
            rol: data.user.rol,
            fullName: data.user.fullName
          };
          sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));
          this.currentUserSubject.next(updatedUser);

          if (newSections.length > 0) {
            this.notificationService.success(
              `🔓 Nuevos accesos habilitados: ${newSections.join(', ')}`,
              8000
            );
          }
          if (removedSections.length > 0) {
            this.notificationService.warning(
              `🔒 Accesos revocados: ${removedSections.join(', ')}`,
              8000
            );
          }
          if (newSections.length === 0 && removedSections.length === 0) {
            this.notificationService.info('Se han actualizado sus permisos de acceso.', 5000);
          }
        }
      }
    } catch (error) {
      console.error('Error al sincronizar permisos:', error);
    }
  }
  private startAutoRefresh() {
    if (this.autoRefreshStarted) return;
    this.autoRefreshStarted = true;
    this.refreshPermissions();
    this.refreshInterval = setInterval(() => {
      this.refreshPermissions();
    }, 30000);
  }
} 