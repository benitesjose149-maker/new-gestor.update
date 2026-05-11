import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';
import { ActivityLogsComponent } from '../shared/activity-logs.component';

@Component({
    selector: 'app-settings-permissions',
    standalone: true,
    imports: [CommonModule, FormsModule, ActivityLogsComponent],
    templateUrl: './settings-permissions.html',
    styleUrl: './settings-permissions.css'
})
export class SettingsPermissionsComponent implements OnInit {
    users: any[] = [];
    blockedAccounts: any[] = [];
    loading = true;
    creatingUser = false;

    constructor(
        private notification: NotificationService,
        private audit: AuditService
    ) {}

    newUser = {
        email: '',
        password: '',
        full_name: '',
        role: 'ADMIN',
        permissions: {
            planilla: false,
            movimientos: false,
            finanzas: false,
            empleados: false,
            archivados: false,
            dashboard: true,
            historial: false,
            vacaciones: false,
            asistencia: false
        }
    };

    async ngOnInit() {
        await Promise.all([
            this.loadUsers(),
            this.loadBlockedAccounts()
        ]);
    }

    async loadUsers() {
        try {
            const response = await fetch(`${API_URL}/api/admin/users`);
            const data = await response.json();
            this.users = Array.isArray(data) ? data : [];
            if (!Array.isArray(data)) {
                console.error('Expected users array but got:', data);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            this.loading = false;
        }
    }

    async loadBlockedAccounts() {
        try {
            const response = await fetch(`${API_URL}/api/admin/security/blocked`);
            this.blockedAccounts = await response.json();
        } catch (error) {
            console.error('Error loading blocked accounts:', error);
        }
    }

    async unblockAccount(account: any) {
        if (!await this.notification.confirm(`¿Está seguro de desbloquear el acceso para ${account.EMAIL}?`, 'Desbloquear Cuenta')) return;

        try {
            const response = await fetch(`${API_URL}/api/admin/security/unblock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: account.EMAIL, ip: account.IP_ADDRESS })
            });

            if (response.ok) {
                this.audit.log(`Desbloqueó cuenta: ${account.EMAIL}`, 'Configuración', `IP: ${account.IP_ADDRESS}`);
                this.notification.success('Usuario desbloqueado con éxito.');
                await this.loadBlockedAccounts();
            } else {
                throw new Error('Failed to unblock');
            }
        } catch (error) {
            console.error('Error unblocking:', error);
            this.notification.error('No se pudo desbloquear al usuario.');
        }
    }

    async updateName(user: any, newName: string) {
        const originalName = user.FULL_NAME;
        user.FULL_NAME = newName;

        try {
            const response = await fetch(`${API_URL}/api/admin/update-permissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.ID_USERS,
                    full_name: user.FULL_NAME,
                    can_planilla: !!user.CAN_PLANILLA,
                    can_movimientos: !!user.CAN_MOVIMIENTOS,
                    can_finanzas: !!user.CAN_FINANZAS,
                    can_empleados: !!user.CAN_EMPLEADOS,
                    can_archivados: !!user.CAN_ARCHIVADOS,
                    can_dashboard: !!user.CAN_DASHBOARD,
                    can_historial: !!user.CAN_HISTORIAL,
                    can_vacaciones: !!user.CAN_VACACIONES,
                    can_asistencia: !!user.CAN_ASISTENCIA
                })
            });

            if (response.ok) {
                const currentUserJson = sessionStorage.getItem('currentUser');
                if (currentUserJson) {
                    const currentUser = JSON.parse(currentUserJson);
                    if (currentUser.email === user.EMAIL) {
                        currentUser.fullName = user.FULL_NAME;
                        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
                    }
                }
                this.audit.log(`Cambió nombre de usuario a: ${user.FULL_NAME}`, 'Configuración', `Email: ${user.EMAIL}`);
            } else {
                throw new Error('Failed to update name');
            }
        } catch (error) {
            console.error('Error updating name:', error);
            user.FULL_NAME = originalName;
            this.notification.error('No se pudo actualizar el nombre.');
        }
    }

    async togglePermission(user: any, permissionField: string) {
        const currentValue = !!user[permissionField];
        const originalValue = user[permissionField];

        if (typeof originalValue === 'number') {
            user[permissionField] = currentValue ? 0 : 1;
        } else {
            user[permissionField] = !currentValue;
        }

        try {
            const response = await fetch(`${API_URL}/api/admin/update-permissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.ID_USERS,
                    full_name: user.FULL_NAME,
                    can_planilla: !!user.CAN_PLANILLA,
                    can_movimientos: !!user.CAN_MOVIMIENTOS,
                    can_finanzas: !!user.CAN_FINANZAS,
                    can_empleados: !!user.CAN_EMPLEADOS,
                    can_archivados: !!user.CAN_ARCHIVADOS,
                    can_dashboard: !!user.CAN_DASHBOARD,
                    can_historial: !!user.CAN_HISTORIAL,
                    can_vacaciones: !!user.CAN_VACACIONES,
                    can_asistencia: !!user.CAN_ASISTENCIA
                })
            });

            if (!response.ok) throw new Error('Failed to update');
            this.audit.log(`Modificó permisos para: ${user.EMAIL}`, 'Configuración');
        } catch (error) {
            console.error('Error updating permission:', error);
            user[permissionField] = originalValue;
            this.notification.error('No se pudo actualizar el permiso.');
        }
    }
    generatePassword() {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
        let pass = "";
        for (let i = 0; i < 12; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.newUser.password = pass;
    }

    async createUser() {
        if (!this.newUser.email || !this.newUser.password || !this.newUser.full_name) {
            this.notification.warning('Por favor, complete todos los campos obligatorios.');
            return;
        }

        this.creatingUser = true;
        try {
            const response = await fetch(`${API_URL}/api/admin/create-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newUser)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.audit.log(`Creó nuevo usuario: ${this.newUser.email}`, 'Configuración', `Nombre: ${this.newUser.full_name}`);
                this.notification.success('Usuario creado con éxito.');
                this.resetNewUser();
                await this.loadUsers();
            } else {
                this.notification.error(data.message || 'Error al crear el usuario.');
            }
        } catch (error) {
            console.error('Error creating user:', error);
            this.notification.error('Error de conexión con el servidor.');
        } finally {
            this.creatingUser = false;
        }
    }

    async deleteUser(user: any) {
        const currentUserData = sessionStorage.getItem('currentUser');
        if (currentUserData) {
            const currentUser = JSON.parse(currentUserData);
            if (currentUser.email === user.EMAIL) {
                this.notification.warning('No puedes eliminar tu propia cuenta por seguridad.');
                return;
            }
        }

        if (!await this.notification.confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario ${user.FULL_NAME} (${user.EMAIL})? Esta acción no se puede deshacer.`, 'Eliminar Administrador')) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/admin/users/${user.ID_USERS}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.audit.log(`Eliminó al usuario: ${user.EMAIL}`, 'Configuración', `Nombre: ${user.FULL_NAME}`);
                this.notification.success('Usuario eliminado correctamente.');
                await this.loadUsers();
            } else {
                this.notification.error(data.message || 'Error al eliminar el usuario.');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            this.notification.error('Error de conexión con el servidor.');
        }
    }

    getAuthHeaders() {
        const masterKey = localStorage.getItem('hwperu_master_key') || '';
        return {
            'Content-Type': 'application/json',
            'x-hwperu-key': masterKey
        };
    }

    resetNewUser() {
        this.newUser = {
            email: '',
            password: '',
            full_name: '',
            role: 'ADMIN',
            permissions: {
                planilla: false,
                movimientos: false,
                finanzas: false,
                empleados: false,
                archivados: false,
                dashboard: true,
                historial: false,
                vacaciones: false,
                asistencia: false
            }
        };
    }
}
