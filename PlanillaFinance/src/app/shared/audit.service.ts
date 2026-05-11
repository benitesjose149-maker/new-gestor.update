import { Injectable } from '@angular/core';
import { API_URL, getAuthHeaders } from '../api-config';
import { AuthService } from '../auth/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  constructor(private auth: AuthService) {}

  /**
   * Registra una acción en el log de auditoría.
   * @param action Descripción de la acción (Ej: "Actualizó bono")
   * @param module Nombre del módulo (Planilla, Finanzas, etc)
   * @param details Detalles adicionales opcionales
   */
  async log(action: string, module: string, details: string = '') {
    const currentUser = this.auth.currentUserValue;
    const userEmail = currentUser ? currentUser.email : 'Usuario Desconocido';

    try {
      await fetch(`${API_URL}/api/admin/logs`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          user: userEmail,
          action,
          module,
          details
        })
      });
    } catch (error) {
      console.error('Error recording audit log:', error);
    }
  }

  /**
   * Obtiene los últimos logs registrados. Solo para Super Admin.
   */
  async getLogs(): Promise<any[]> {
    try {
      const response = await fetch(`${API_URL}/api/admin/logs`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      return await response.json();
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return [];
    }
  }
}
