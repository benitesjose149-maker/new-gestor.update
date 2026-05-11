
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';

interface Vacation {
    ID?: number;
    ID_EMPLOYEE: number;
    FECHA_INICIO: string;
    FECHA_FIN: string;
    DIAS_UTILES: number;
    ESTADO: string;
    OBSERVACIONES: string;
    NOMBRE?: string;
    APELLIDOS?: string;
}

interface Employee {
    id: number;
    nombre: string;
    apellidos: string;
    cargo: string;
    tipoTrabajador: string;
}

@Component({
    selector: 'app-vacations',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './vacations.html',
    styleUrl: './vacations.css'
})
export class VacationsComponent implements OnInit {
    loading: boolean = false;
    employees: Employee[] = [];
    vacations: Vacation[] = [];

    showModal: boolean = false;
    isEditing: boolean = false;

    currentVacation: any;

    estados = ['PROGRAMADO', 'TOMADO', 'CONCLUIDO', 'CANCELADO'];

    get scheduledCount(): number {
        return (this.vacations || []).filter(v => this.getDisplayStatus(v) === 'PROGRAMADO').length;
    }

    get consumedDaysMonth(): number {
        const now = new Date();
        const curMonth = now.getMonth();
        const curYear = now.getFullYear();

        return (this.vacations || [])
            .filter(v => {
                const start = new Date(v.FECHA_INICIO);
                return start.getMonth() === curMonth && start.getFullYear() === curYear && this.getDisplayStatus(v) === 'TOMADO';
            })
            .reduce((sum, v) => sum + (v.DIAS_UTILES || 0), 0);
    }

    constructor(private cdr: ChangeDetectorRef, private notification: NotificationService) {
        console.log('VacationsComponent constructor called');
        this.currentVacation = this.getEmptyVacation();
    }

    ngOnInit() {
        console.log('VacationsComponent ngOnInit called');
        this.loadAll();
    }

    async loadAll() {
        this.loading = true;
        try {
            const [empRes, vacRes] = await Promise.all([
                fetch(`${API_URL}/api/empleados`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/api/vacaciones`, { headers: getAuthHeaders() })
            ]);

            if (empRes.ok) {
                const allEmps = await empRes.json();
                this.employees = allEmps
                    .filter((e: any) => (e.tipoTrabajador || e.tipo_trabajador || '').toUpperCase() === 'PLANILLA')
                    .map((e: any) => ({
                        ...e,
                        id: e.id || e._id || e.ID_EMPLOYEE,
                        nombre: e.nombre || e.NOMBRE,
                        apellidos: e.apellidos || e.APELLIDOS
                    }));
            }

            if (vacRes.ok) {
                this.vacations = await vacRes.json();
                console.log('Vacations loaded:', this.vacations.length);
            } else {
                console.error('Failed to load vacations:', vacRes.status);
            }
        } catch (error) {
            console.error('Error loading vacations data:', error);
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    getEmptyVacation() {
        return {
            idEmployee: null,
            fechaInicio: new Date().toISOString().split('T')[0],
            fechaFin: new Date().toISOString().split('T')[0],
            diasUtiles: 0,
            estado: 'PROGRAMADO',
            observaciones: ''
        };
    }

    abrirModal(vacation?: Vacation) {
        if (vacation) {
            this.isEditing = true;
            this.currentVacation = {
                id: vacation.ID,
                idEmployee: vacation.ID_EMPLOYEE,
                fechaInicio: this.formatDate(vacation.FECHA_INICIO),
                fechaFin: this.formatDate(vacation.FECHA_FIN),
                diasUtiles: vacation.DIAS_UTILES,
                estado: vacation.ESTADO,
                observaciones: vacation.OBSERVACIONES
            };
        } else {
            this.isEditing = false;
            this.currentVacation = this.getEmptyVacation();
        }
        this.showModal = true;
        this.calcularDiasUtiles();
    }

    cerrarModal() {
        this.showModal = false;
    }

    formatDate(dateStr: any): string {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            return date.toISOString().split('T')[0];
        } catch {
            return '';
        }
    }

    async guardarVacacion() {
        if (!this.currentVacation.idEmployee || this.currentVacation.diasUtiles <= 0) {
            this.notification.warning('Por favor complete los campos obligatorios.');
            return;
        }

        try {
            const url = this.isEditing
                ? `${API_URL}/api/vacaciones/${this.currentVacation.id}`
                : `${API_URL}/api/vacaciones`;

            const method = this.isEditing ? 'PUT' : 'POST';

            const payload = {
                idEmployee: this.currentVacation.idEmployee,
                fechaInicio: this.currentVacation.fechaInicio,
                fechaFin: this.currentVacation.fechaFin,
                diasUtiles: this.currentVacation.diasUtiles,
                estado: this.currentVacation.estado,
                observaciones: this.currentVacation.observaciones
            };

            const response = await fetch(url, {
                method: method,
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                this.notification.success('Vacaciones guardadas correctamente.');
                this.cerrarModal();
                this.loadAll();
            } else {
                const errData = await response.json().catch(() => ({}));
                console.error('Server error:', errData);
                this.notification.error(`Error al guardar vacaciones: ${errData.error || response.statusText}`);
            }
        } catch (error) {
            console.error('Error saving vacation:', error);
            this.notification.error('Error de conexión');
        }
    }

    async eliminarVacacion(id: any) {
        if (!id) return;
        if (!await this.notification.confirm('¿Está seguro de eliminar este registro?', 'Confirmar Eliminación')) return;
        try {
            const response = await fetch(`${API_URL}/api/vacaciones/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            if (response.ok) {
                this.notification.success('Registro eliminado.');
                this.loadAll();
            } else {
                this.notification.error('Error al intentar eliminar.');
            }
        } catch (error) {
            console.error('Error deleting vacation:', error);
            this.notification.error('Error de conexión.');
        }
    }

    getVacationDaysForEmployee(empId: number): number {
        return this.vacations
            .filter(v => v.ID_EMPLOYEE === empId && v.ESTADO === 'TOMADO')
            .reduce((sum, v) => sum + v.DIAS_UTILES, 0);
    }

    calcularDiasUtiles() {
        if (!this.currentVacation.fechaInicio || !this.currentVacation.fechaFin) return;

        const start = new Date(this.currentVacation.fechaInicio + 'T00:00:00');
        const end = new Date(this.currentVacation.fechaFin + 'T00:00:00');

        if (start > end) {
            this.currentVacation.diasUtiles = 0;
            return;
        }

        let count = 0;
        let cur = new Date(start);

        while (cur < end) {
            const day = cur.getDay();
            if (day !== 0 && day !== 6) {
                count++;
            }
            cur.setDate(cur.getDate() + 1);
        }

        this.currentVacation.diasUtiles = count;
        this.cdr.detectChanges();
    }

    getDisplayStatus(vac: Vacation): string {
        if (vac.ESTADO === 'CANCELADO') return 'CANCELADO';

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const day = now.getDate();
        const todayUtc = Date.UTC(year, month, day);

        const startDate = new Date(vac.FECHA_INICIO);
        const startUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());

        const endDate = new Date(vac.FECHA_FIN);
        const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());

        if (todayUtc < startUtc) return 'PROGRAMADO';
        if (todayUtc > endUtc) return 'CONCLUIDO';
        return 'TOMADO';
    }
}
