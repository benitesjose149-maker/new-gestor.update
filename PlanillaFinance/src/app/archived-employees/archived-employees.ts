import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';

interface Employee {
    _id?: string;
    nombre: string;
    apellidos: string;
    dni: string;
    email?: string;
    cargo: string;
    departamento: string;
    estado: string;
    sueldo?: number;
    fechaInicio?: string;
    fechaFinContrato?: string;
    [key: string]: any;
}

interface EmployeeFormData {
    _id?: string;
    nombre: string;
    apellidos: string;
    dni: string;
    sexo: string;
    nacionalidad: string;
    telefono: string;
    contactoEmergencia: string;
    numeroEmergencia: string;
    fechaNacimiento: string;
    direccion: string;
    email: string;
    cargo: string;
    departamento: string;
    tipoTrabajador: string;
    regimenPensionario: string;
    sueldo: number;
    asignacionFamiliar: boolean;
    calculoAfpMinimo: boolean;
    fechaInicio: string;
    fechaFinContrato: string;
    tipoContrato: string;
    horarioTrabajo: string;
    banco: string;
    tipoCuenta: string;
    numeroCuenta: string;
    cci: string;
    nivelEducativo: string;
    estado: string;
    motivo?: string;
}

@Component({
    selector: 'app-archived-employees',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './archived-employees.html',
    styleUrl: './archived-employees.css'
})
export class ArchivedEmployeesComponent implements OnInit {
    searchTerm: string = '';
    employees: Employee[] = [];
    filteredEmployees: Employee[] = [];
    showAddModal: boolean = false;
    isViewOnly: boolean = false;

    newEmployee: EmployeeFormData = {
        nombre: '', apellidos: '', dni: '', sexo: '', nacionalidad: '', telefono: '', contactoEmergencia: '', numeroEmergencia: '', fechaNacimiento: '', direccion: '',
        email: '', cargo: '', departamento: '', tipoTrabajador: 'PLANILLA', regimenPensionario: 'SNP/ONP', sueldo: 0, asignacionFamiliar: false,
        calculoAfpMinimo: false,
        fechaInicio: new Date().toISOString().split('T')[0], fechaFinContrato: '', tipoContrato: '', horarioTrabajo: '',
        banco: '', tipoCuenta: '', numeroCuenta: '', cci: '', nivelEducativo: '', estado: 'Activo', motivo: ''
    };

    cargos: string[] = ['Técnico', 'Administrador', 'Vendedor', 'Gerente', 'Recepcionista', 'Programador', 'Administrativo', 'Ventas', 'Gerencia', 'Soporte Técnico', 'Diseño', 'Marketing'];

    departamentosPorCargo: { [key: string]: string[] } = {
        'Técnico': ['Técnico de Soporte', 'Infraestructura', 'Soporte N2'],
        'Administrador': ['Administración General', 'Contabilidad', 'RRHH', 'Tesorería'],
        'Vendedor': ['Ventas', 'Ejecutivo Comercial', 'Asesor de Ventas'],
        'Gerente': ['Administración General', 'Gerencia General', 'Operaciones'],
        'Recepcionista': ['Atención al Cliente', 'Secretaría', 'Recepción'],
        'Programador': ['Programador Full Stack', 'Programador Backend', 'Programador Frontend', 'Programador Analytics', 'DevOps', 'Mobile Developer'],
        'Administrativo': ['RRHH', 'Contabilidad', 'Logística', 'Secretaría', 'Tesorería'],
        'Ventas': ['Ejecutivo Comercial', 'Asesor de Ventas', 'Atención al Cliente', 'Post-Venta'],
        'Gerencia': ['Gerencia General', 'Gerencia de Proyectos', 'Gerencia Operativa', 'Directorio'],
        'Soporte Técnico': ['Help Desk N1', 'Soporte N2', 'Infraestructura', 'Redes'],
        'Diseño': ['Diseño UX/UI', 'Diseño Gráfico', 'Diseño de Producto'],
        'Marketing': ['Marketing Digital', 'Community Management', 'SEO/SEM', 'Content Creator']
    };

    availableDepartamentos: string[] = [];

    constructor(private notification: NotificationService) { }

    ngOnInit() {
        this.loadArchivedEmployees();
    }

    onCargoChange() {
        const selectedCargo = this.newEmployee.cargo;
        this.availableDepartamentos = selectedCargo && this.departamentosPorCargo[selectedCargo]
            ? this.departamentosPorCargo[selectedCargo]
            : [];
        if (!this.availableDepartamentos.includes(this.newEmployee.departamento)) {
            this.newEmployee.departamento = '';
        }
    }

    formatDate(dateStr: any): string {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '';
            return date.toISOString().split('T')[0];
        } catch { return ''; }
    }

    async loadArchivedEmployees() {
        try {
            const response = await fetch(API_URL + '/api/empleados-archivados', {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const rawData = await response.json();
                this.employees = rawData.map((emp: any) => ({
                    ...emp,
                    nombre: emp.nombre || emp.name || 'Sin Nombre',
                    apellidos: emp.apellidos || emp.surname || '',
                    cargo: emp.cargo || emp.position || 'Sin Cargo',
                    departamento: emp.departamento || emp.department || 'Sin Dept',
                    email: emp.email || '',
                    estado: emp.estado || 'Inactivo',
                    dni: emp.dni || '',
                    fechaInicio: emp.fechaInicio || emp.startDate,
                    fechaFinContrato: emp.fechaFinContrato || 'Desconocida',
                    sueldo: emp.sueldo || emp.salary,
                    tabla: emp.tabla // Include the source table information
                }));
                this.filterEmployees();
            }
        } catch (error) { console.error('Error loading:', error); }
    }

    filterEmployees() {
        const search = this.searchTerm.toLowerCase();
        this.filteredEmployees = this.employees.filter(emp =>
            (emp.nombre || '').toLowerCase().includes(search) ||
            (emp.apellidos || '').toLowerCase().includes(search) ||
            (emp.dni || '').toLowerCase().includes(search) ||
            (emp.cargo || '').toLowerCase().includes(search) ||
            (emp.departamento || '').toLowerCase().includes(search)
        );
    }

    viewEmployee(employee: any) {
        this.isViewOnly = true;
        this.prepareModal(employee);
    }

    rehireEmployee(employee: any) {
        this.isViewOnly = false;
        this.prepareModal(employee);
        this.newEmployee.estado = 'Activo'; // Ensure state is Active for re-hiring
        this.newEmployee.fechaInicio = new Date().toISOString().split('T')[0]; // Set today's date for new contract
        this.newEmployee.fechaFinContrato = ''; // Clear end date since it's a new contract
    }

    private prepareModal(employee: any) {
        this.newEmployee = {
            ...employee,
            fechaNacimiento: this.formatDate(employee.fechaNacimiento),
            fechaInicio: this.formatDate(employee.fechaInicio),
            fechaFinContrato: this.formatDate(employee.fechaFinContrato)
        };

        if (this.newEmployee.cargo && !this.cargos.includes(this.newEmployee.cargo)) {
            this.cargos = [...this.cargos, this.newEmployee.cargo];
        }

        const originalDept = this.newEmployee.departamento;
        this.showAddModal = true;
        this.onCargoChange();

        if (originalDept) {
            this.newEmployee.departamento = originalDept;
            if (!this.availableDepartamentos.includes(originalDept)) {
                this.availableDepartamentos = [...this.availableDepartamentos, originalDept];
            }
        }
    }

    closeAddModal() {
        this.showAddModal = false;
    }

    async saveEmployee() {
        try {
            const id = (this.newEmployee as any).id || (this.newEmployee as any)._id;
            const url = API_URL + `/api/empleados/${id}/reactivar`;

            const response = await fetch(url, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ ...this.newEmployee, ACTIVO: 1 })
            });

            if (response.ok) {
                this.notification.success('Empleado re-contratado exitosamente.');
                this.closeAddModal();
                this.loadArchivedEmployees();
            } else {
                const err = await response.json();
                this.notification.error('Error al re-contratar: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error rehiring:', error);
            this.notification.error('Error de conexión.');
        }
    }

    async deleteEmployee(employee: any) {
        const id = employee.id || employee._id;
        const tabla = employee.tabla;

        if (!await this.notification.confirm(`¿Está seguro de que desea eliminar permanentemente a ${employee.nombre} ${employee.apellidos}? Esta acción no se puede deshacer.`, 'Eliminar Permanentemente')) {
            return;
        }

        try {
            const response = await fetch(API_URL + `/api/empleados-archivados/${id}?tabla=${tabla}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                this.notification.success('Empleado eliminado permanentemente.');
                this.loadArchivedEmployees();
            } else {
                const err = await response.json();
                this.notification.error('Error al eliminar: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error deleting:', error);
            this.notification.error('Error de conexión.');
        }
    }
}