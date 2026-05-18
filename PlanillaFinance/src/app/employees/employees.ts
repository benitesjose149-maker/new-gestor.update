import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';

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
    biometricId?: number;
    biometricPassword?: string;
    entryTime?: string;
    exitTime?: string;
    syncToBiometric?: boolean;
}

@Component({
    selector: 'app-employees',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './employees.html',
    styleUrl: './employees.css'
})
export class GestionEmpleadosComponent {
    searchTerm: string = '';
    showAddModal: boolean = false;
    submitted: boolean = false;
    searchingDni: boolean = false;
    isViewOnly: boolean = false;
    biometricStatus: string = '';
    isBiometricRegistered: boolean = false;

    showLeaveModal: boolean = false;
    leaveReason: string = '';
    selectedEmployeeForLeave: any = null;

    employees: Employee[] = [];
    filteredEmployees: Employee[] = [];

    newEmployee: EmployeeFormData = {
        nombre: '', apellidos: '', dni: '', sexo: '', nacionalidad: '', telefono: '', contactoEmergencia: '', numeroEmergencia: '', fechaNacimiento: '', direccion: '',
        email: '', cargo: '', departamento: '', tipoTrabajador: 'PLANILLA', regimenPensionario: 'SNP/ONP', sueldo: 0, asignacionFamiliar: false,
        calculoAfpMinimo: false,
        fechaInicio: new Date().toISOString().split('T')[0], fechaFinContrato: '', tipoContrato: '', horarioTrabajo: '',
        banco: '', tipoCuenta: '', numeroCuenta: '', cci: '', nivelEducativo: '', estado: 'Activo',
        biometricId: undefined, biometricPassword: '', entryTime: '', exitTime: '', syncToBiometric: false,
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

    constructor(
        private notification: NotificationService,
        private audit: AuditService
    ) {
        this.loadEmployees();
    }

    async checkBiometricRegistration() {
        console.log('--- VERIFICANDO REGISTRO BIOMÉTRICO ---');
        console.log('ID a consultar:', this.newEmployee.biometricId);
        
        if (!this.newEmployee.biometricId) {
            console.log('Sin ID, limpiando estado.');
            this.biometricStatus = '';
            this.isBiometricRegistered = false;
            return;
        }

        try {
            const url = `${API_URL}/api/zkteco/check-user/${this.newEmployee.biometricId}`;
            console.log('Llamando a:', url);
            
            const response = await fetch(url, {
                headers: getAuthHeaders()
            });

            console.log('Respuesta verificación recibida. Status:', response.status);
            
                if (response.ok) {
                    const data = await response.json();
                    console.log('--- DATOS RECIBIDOS DEL SERVIDOR ---');
                    console.log(JSON.stringify(data, null, 2));
                    
                    if (data.exists) {
                    console.log('USUARIO ENCONTRADO EN EQUIPO. Bloqueando UI.');
                    this.biometricStatus = '✅ Usuario ya registrado en equipo';
                    this.isBiometricRegistered = true;
                    this.newEmployee.syncToBiometric = false;
                    this.newEmployee.biometricPassword = data.password || ''; // Auto-llenar PIN
                } else {
                    console.log('Usuario NO encontrado en equipo. Habilitando UI.');
                    this.biometricStatus = '⚠️ No registrado en equipo';
                    this.isBiometricRegistered = false;
                    this.newEmployee.syncToBiometric = true;
                }
            } else {
                console.error('Error en la respuesta del servidor de verificación');
            }
        } catch (error) {
            console.error('Error crítico verificando biométrico:', error);
        }
    }

    onCargoChange() {
        const selectedCargo = this.newEmployee.cargo;
        if (selectedCargo && this.departamentosPorCargo[selectedCargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[selectedCargo];
        } else {
            this.availableDepartamentos = [];
        }
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
        } catch {
            return '';
        }
    }

    trackByEmployee(index: number, employee: Employee): string {
        return employee._id || index.toString();
    }

    async loadEmployees() {
        try {
            const response = await fetch(API_URL + '/api/empleados', {
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
                    estado: emp.estado || emp.status || 'Activo',
                    dni: emp.dni || '',
                    fechaInicio: emp.fechaInicio || emp.startDate,
                    sueldo: emp.sueldo || emp.salary,
                }));
                this.filteredEmployees = [...this.employees];
            }
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    }

    onDniInput() {
        setTimeout(() => {
            this.newEmployee.dni = (this.newEmployee.dni || '').toString().replace(/[^0-9]/g, '').slice(0, 8);
        }, 0);
    }

    async searchDni() {
        if (!this.newEmployee.dni || this.newEmployee.dni.length !== 8) {
            this.notification.warning('Por favor ingrese un DNI válido de 8 dígitos.');
            return;
        }
        this.searchingDni = true;
        try {
            const response = await fetch(API_URL + `/api/reniec/${this.newEmployee.dni}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                this.newEmployee.nombre = data.nombres || '';
                this.newEmployee.apellidos = data.apellidos || '';
                this.newEmployee.direccion = data.direccion || this.newEmployee.direccion;
                this.newEmployee.nacionalidad = data.nacionalidad || 'Peruana';
            } else {
                throw new Error('Error en la consulta');
            }
        } catch (error) {
            console.error('Error buscar DNI:', error);
            this.notification.error('No se pudieron obtener los datos de la RENIEC para este DNI.');
        } finally {
            this.searchingDni = false;
        }
    }

    filterEmployees() {
        this.filteredEmployees = this.employees.filter(emp =>
            (emp.nombre || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.cargo || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
            (emp.departamento || '').toLowerCase().includes(this.searchTerm.toLowerCase())
        );
    }

    openAddModal() {
        this.showAddModal = true;
        this.isViewOnly = false;
        this.submitted = false;
        this.newEmployee = {
            nombre: '', apellidos: '', dni: '', sexo: '', nacionalidad: '', telefono: '', contactoEmergencia: '', numeroEmergencia: '', fechaNacimiento: '', direccion: '',
            email: '', cargo: '', departamento: '', tipoTrabajador: 'PLANILLA', regimenPensionario: 'SNP/ONP', sueldo: 0, asignacionFamiliar: false,
            calculoAfpMinimo: false,
            fechaInicio: new Date().toISOString().split('T')[0], fechaFinContrato: '', tipoContrato: '', horarioTrabajo: '',
            banco: '', tipoCuenta: '', numeroCuenta: '', cci: '', nivelEducativo: '', estado: 'Activo',
            biometricId: undefined, entryTime: '', exitTime: ''
        };
        this.availableDepartamentos = [];
    }

    closeAddModal() {
        this.showAddModal = false;
    }

    async saveEmployee() {
        const isEditing = !!(this.newEmployee as any)._id;
        this.submitted = true;
        if (!isEditing) {
            if (!this.newEmployee.dni || !this.newEmployee.nombre || !this.newEmployee.apellidos || !this.newEmployee.telefono || !this.newEmployee.direccion || !this.newEmployee.fechaNacimiento || !this.newEmployee.cargo || !this.newEmployee.departamento) {
                this.notification.warning('Por favor complete todos los campos obligatorios.');
                return;
            }
        }
        try {
            const url = isEditing ? API_URL + `/api/empleados/${(this.newEmployee as any)._id}` : API_URL + '/api/empleados';
            const method = isEditing ? 'PUT' : 'POST';
            const response = await fetch(url, {
                method: method,
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newEmployee)
            });
            if (response.ok) {
                this.audit.log(
                    `${isEditing ? 'Actualizó' : 'Registró'} empleado: ${this.newEmployee.nombre} ${this.newEmployee.apellidos}`,
                    'Empleados',
                    `DNI: ${this.newEmployee.dni}`
                );
                this.closeAddModal();
                this.loadEmployees();
                this.notification.success(`Empleado ${isEditing ? 'actualizado' : 'registrado'} exitosamente.`);
            } else {
                const err = await response.json();
                this.notification.error('Error: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            this.notification.error('Error de conexión con el servidor.');
        }
    }

    closeNotification() { }

    viewEmployee(employee: any) {
        this.isViewOnly = true;
        this.submitted = false;
        this.newEmployee = { ...employee, fechaNacimiento: this.formatDate(employee.fechaNacimiento), fechaInicio: this.formatDate(employee.fechaInicio), fechaFinContrato: this.formatDate(employee.fechaFinContrato) };
        this.showAddModal = true;
        this.checkBiometricRegistration();
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
    }

    editEmployee(employee: any) {
        this.isViewOnly = false;
        this.submitted = false;
        this.newEmployee = { ...employee, fechaNacimiento: this.formatDate(employee.fechaNacimiento), fechaInicio: this.formatDate(employee.fechaInicio), fechaFinContrato: this.formatDate(employee.fechaFinContrato) };
        this.showAddModal = true;
        this.checkBiometricRegistration();
        if (this.newEmployee.cargo && this.departamentosPorCargo[this.newEmployee.cargo]) {
            this.availableDepartamentos = this.departamentosPorCargo[this.newEmployee.cargo];
        } else {
            this.availableDepartamentos = [this.newEmployee.departamento];
        }
    }

    openLeaveModal(employee: any) {
        this.selectedEmployeeForLeave = employee;
        this.leaveReason = '';
        this.showLeaveModal = true;
    }

    closeLeaveModal() {
        this.showLeaveModal = false;
        this.selectedEmployeeForLeave = null;
        this.leaveReason = '';
    }

    async confirmLeave() {
        if (!this.selectedEmployeeForLeave) return;
        if (!this.leaveReason.trim()) {
            this.notification.warning('Por favor ingrese el motivo de la baja.');
            return;
        }
        try {
            const response = await fetch(API_URL + `/api/empleados/${this.selectedEmployeeForLeave._id}`, {
                method: 'DELETE',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo: this.leaveReason })
            });
            if (response.ok) {
                const nombreEmpleado = this.selectedEmployeeForLeave.nombre;
                this.audit.log(
                    `Dio de baja a empleado: ${nombreEmpleado} ${this.selectedEmployeeForLeave.apellidos}`,
                    'Empleados',
                    `Motivo: ${this.leaveReason}`
                );
                this.closeLeaveModal();
                this.loadEmployees();
                this.notification.success(`Empleado ${nombreEmpleado} dado de baja y archivado.`);
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }));
                this.notification.error('Error: ' + (errorData.error || 'No se pudo procesar la baja'));
            }
        } catch (error) {
            console.error('Error de conexión:', error);
            this.notification.error('Error de conexión con el servidor.');
        }
    }
}
