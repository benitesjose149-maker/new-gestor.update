
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

interface PayrollEmployee {
    _id: string;
    nombre: string;
    apellidos: string;
    cargo: string;
    sueldo: number;
    tipoTrabajador: string;
    regimenPensionario: string;
    entidadDisplay?: string; // New field for display
    calculoAfpMinimo: boolean;
    asignacionFamiliar: boolean;

    // Editable fields
    bonos: number;
    horasExtras: number;
    adelanto: number;
    prestamo: number;
    faltasDias: number;
    faltasHoras: number;
    descuentoAdicional: number;
    cuotaDetalle: string;

    // Calculated fields
    bonosDetalle: any[];
    montoHorasExtras: number;
    montoAsignacionFamiliar: number;
    baseCalculo: number;
    afpPorcentaje: number;
    descuentoAfp: number;
    montoFaltas: number;
    totalDescuento: number;
    remuneracionNeta: number;
    estado: string;
    observaciones: string;
    asistenciaSugerida?: number;
}

@Component({
    selector: 'app-planilla',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './planilla.html',
    styleUrl: './planilla.css'
})
export class PlanillaComponent implements OnInit {
    employees: PayrollEmployee[] = [];
    currentMonth: string = '';
    currentYear: number = new Date().getFullYear();

    showDetailModal: boolean = false;
    selectedEmployee: PayrollEmployee | null = null;

    floor = Math.floor;
    round = Math.round;

    constructor(
        private notification: NotificationService,
        private audit: AuditService
    ) { }

    ngOnInit() {
        this.currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });
        this.loadEmployees();
    }

    async loadEmployees() {
        try {
            const empResponse = await fetch(API_URL + '/api/planilla-borrador', {
                headers: getAuthHeaders()
            });
            const data = await empResponse.json();

            // Verificamos si la respuesta es realmente una lista (Array)
            if (!Array.isArray(data)) {
                console.warn('La respuesta de la planilla no es una lista:', data);
                this.employees = [];
                return;
            }

            // Calculate current month index (0-11)
            const monthNames = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
            ];
            const currentMonthLower = this.currentMonth.toLowerCase();
            const currentMonthIndex = monthNames.findIndex(m => m === currentMonthLower);

            this.employees = data.map((emp: any) => {
                const bonosDetalle = emp.bonosDetalle || [];
                const validBonos = bonosDetalle.filter((b: any) => {
                    if (b.permanente) return true;
                    if (!b.fecha) return false;
                    const bd = new Date(b.fecha);
                    return bd.getMonth() === currentMonthIndex && bd.getFullYear() === this.currentYear;
                });
                const bonosTotal = validBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

                return {
                    ...emp,
                    bonosDetalle: bonosDetalle,
                    bonos: bonosTotal,
                    horasExtras: emp.horasExtras || 0,
                    // Use backend-calculated values from ADVANCES table
                    adelanto: emp.adelanto || 0,
                    prestamo: emp.prestamo || 0,
                    faltasDias: emp.faltasDias || 0,
                    faltasHoras: emp.faltasHoras || 0,
                    descuentoAdicional: emp.descuentoAdicional || 0,
                    asistenciaSugerida: emp.asistenciaSugerida || 0,
                    descuentosAdicionales: emp.descuentosAdicionales || [],
                    observaciones: emp.observaciones || '',
                    montoAsignacionFamiliar: emp.asignacionFamiliar ? 102.50 : 0,
                    estado: emp.planillaEstado || 'PENDIENTE'
                };
            });

            this.calculateAll();
        } catch (error) {
            console.error('Error loading employees:', error);
            this.employees = [];
        }
    }

    // Modal open/close
    openDetailModal(emp: PayrollEmployee) {
        this.selectedEmployee = emp;
        this.showDetailModal = true;
    }

    closeDetailModal() {
        this.showDetailModal = false;
        this.selectedEmployee = null;
    }

    async updateEmployee(emp: PayrollEmployee) {
        try {
            await fetch(API_URL + `/api/planilla-borrador/${emp._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(emp)
            });
        } catch (error) {
            console.error('Error updating employee:', error);
        }
    }

    calculateAll() {
        this.employees.forEach(emp => this.calculateEmployee(emp, false));
    }

    calculateEmployee(emp: PayrollEmployee, save: boolean = true) {
        // Handle Display for Entidad / Regimen
        if (emp.tipoTrabajador === 'RXH' || emp.tipoTrabajador === 'HONORARIOS') {
            emp.entidadDisplay = 'HONORARIOS';
            // Force values to 0 for RXH Asignacion Familiar only
            emp.montoAsignacionFamiliar = 0;
        } else {
            // Map DB values to display names
            const regimen = (emp.regimenPensionario || '').toUpperCase();
            if (regimen.includes('INTEGRA')) emp.entidadDisplay = 'AFP INTEGRA';
            else if (regimen.includes('PRIMA')) emp.entidadDisplay = 'AFP PRIMA';
            else if (regimen.includes('HABITAT')) emp.entidadDisplay = 'AFP HABITAT';
            else if (regimen.includes('PROFUTURO')) emp.entidadDisplay = 'AFP PROFUTURO';
            else if (regimen.includes('SNP') || regimen.includes('ONP')) emp.entidadDisplay = 'ONP (SNP)';
            else emp.entidadDisplay = emp.regimenPensionario || '';
        }

        const sueldo = emp.sueldo || 0;
        emp.baseCalculo = sueldo + (emp.bonos || 0);

        const hourlyRate = (sueldo / 240) * 1.25;
        emp.montoHorasExtras = hourlyRate * (emp.horasExtras || 0);

        const totalIngresos = sueldo + emp.montoHorasExtras + (emp.bonos || 0);

        let afpRate = 0;
        if (emp.tipoTrabajador !== 'RXH' && emp.tipoTrabajador !== 'HONORARIOS') {
            const regimenUpper = (emp.regimenPensionario || '').toUpperCase();
            if (regimenUpper.includes('INTEGRA') || regimenUpper.includes('PRIMA') || regimenUpper.includes('HABITAT') || regimenUpper.includes('PROFUTURO')) {
                afpRate = 0.1138; // AFP 11.38%
            } else if (regimenUpper.includes('SNP') || regimenUpper.includes('ONP')) {
                afpRate = 0.13; // ONP 13%
            }
        }
        emp.afpPorcentaje = afpRate * 100;

        // AFP siempre se calcula sobre el mínimo vital (1,130) según requerimiento
        const MINIMO_PARA_AFP = 1130;
        let baseAfp = MINIMO_PARA_AFP;

        emp.descuentoAfp = parseFloat((baseAfp * afpRate).toFixed(2));

        // Absences deduction based on Sueldo Base
        const dayRate = sueldo / 30;
        const hourRate = dayRate / 8;
        emp.montoFaltas = parseFloat(((dayRate * emp.faltasDias) + (hourRate * emp.faltasHoras)).toFixed(2));

        // Total Discounts
        emp.totalDescuento = emp.descuentoAfp + emp.adelanto + emp.prestamo + emp.montoFaltas + emp.descuentoAdicional;
        emp.totalDescuento = parseFloat(emp.totalDescuento.toFixed(2));

        // Net Salary
        emp.remuneracionNeta = totalIngresos - emp.totalDescuento;
        emp.remuneracionNeta = parseFloat(emp.remuneracionNeta.toFixed(2));

        if (save) {
            this.updateEmployee(emp);
        }
    }

    async exportToExcel() {
        if (this.employees.length === 0) {
            this.notification.warning('No hay datos para exportar');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Planilla');

        const startRow = 4;
        const startCol = 4;

        // Header Styling (Emerald Green)
        const headerRow = worksheet.getRow(startRow);
        headerRow.height = 30;

        // Mapping keys to column positions (starting from startCol)
        const columns = [
            { header: 'N°', width: 5 },
            { header: 'Nombres y Apellidos', width: 35 },
            { header: 'Cargo', width: 20 },
            { header: 'Sueldo Base', width: 14 },
            { header: 'Asig. Familiar', width: 14 },
            { header: 'Bonos', width: 12 },
            { header: 'Horas Extras', width: 14 },
            { header: 'Base de Cálculo', width: 16 },
            { header: 'Entidad Pensión', width: 20 },
            { header: 'Desc. Pensión', width: 14 },
            { header: 'Adelantos', width: 12 },
            { header: 'Préstamos', width: 12 },
            { header: 'Préstamo Cuota', width: 15 },
            { header: 'Faltas (Monto)', width: 14 },
            { header: 'Desc. Adicionales', width: 16 },
            { header: 'Total Descuento', width: 16 },
            { header: 'Neto a Pagar', width: 16 },
            { header: 'Estado', width: 14 },
            { header: 'Observaciones', width: 30 }
        ];

        columns.forEach((col, i) => {
            const cell = headerRow.getCell(startCol + i);
            cell.value = col.header;
            worksheet.getColumn(startCol + i).width = col.width;

            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF10B981' }
            };
            cell.font = {
                name: 'Arial',
                size: 11,
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // Add Data
        this.employees.forEach((emp, index) => {
            const rowIndex = startRow + 1 + index;
            const dataRow = worksheet.getRow(rowIndex);

            const values = [
                index + 1,
                `${emp.nombre} ${emp.apellidos}`,
                emp.cargo,
                emp.sueldo,
                emp.montoAsignacionFamiliar,
                emp.bonos,
                emp.montoHorasExtras,
                emp.baseCalculo + emp.montoHorasExtras,
                emp.regimenPensionario === 'HONORARIOS' ? 'HONORARIOS' : emp.entidadDisplay || emp.regimenPensionario,
                emp.descuentoAfp,
                emp.adelanto,
                emp.prestamo,
                emp.cuotaDetalle || '',
                emp.montoFaltas,
                emp.descuentoAdicional,
                emp.totalDescuento,
                emp.remuneracionNeta,
                emp.estado,
                emp.observaciones
            ];

            values.forEach((val, i) => {
                const cell = dataRow.getCell(startCol + i);
                cell.value = val;
                cell.alignment = { vertical: 'middle' };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };

                // Alignment for IDs and Status
                if ([0, 12, 17].includes(i)) {
                    cell.alignment.horizontal = 'center';
                }

                // Currency formatting
                if ([3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16].includes(i)) {
                    cell.numFmt = '"S/" #,##0.00;[Red]-"S/" #,##0.00';
                    cell.alignment.horizontal = 'right';
                }
            });
        });

        // Generate and download
        const buffer = await workbook.xlsx.writeBuffer();
        const fileName = `Planilla_${this.currentMonth.toUpperCase()}_${this.currentYear}.xlsx`;
        saveAs(new Blob([buffer]), fileName);
    }

    async savePlanilla() {
        if (!await this.notification.confirm('¿Desea guardar la planilla del mes actual? Se registrará permanentemente en el historial de pagos.', 'Guardar Planilla')) return;

        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
        const currentMonthIndex = monthNames.findIndex(m => m === this.currentMonth.toLowerCase());
        const periodo = `${this.currentYear}-${String(currentMonthIndex + 1).padStart(2, '0')}`;

        const payload = {
            periodo,
            mes: this.currentMonth,
            año: this.currentYear,
            empleados: this.employees.map(emp => ({
                empleadoId: emp._id,
                nombre: emp.nombre,
                apellidos: emp.apellidos,
                cargo: emp.cargo,
                tipoTrabajador: emp.tipoTrabajador,
                sueldo: emp.sueldo,
                bonos: emp.bonos,
                bonosDetalle: emp.bonosDetalle || [],
                horasExtras: emp.horasExtras,
                montoHorasExtras: emp.montoHorasExtras,
                regimenPensionario: emp.regimenPensionario,
                descuentoAfp: emp.descuentoAfp,
                adelanto: emp.adelanto,
                prestamo: emp.prestamo,
                faltasDias: emp.faltasDias,
                faltasHoras: emp.faltasHoras,
                montoFaltas: emp.montoFaltas,
                descuentoAdicional: emp.descuentoAdicional,
                totalDescuento: emp.totalDescuento,
                remuneracionNeta: emp.remuneracionNeta,
                estado: emp.estado,
                observaciones: emp.observaciones
            }))
        };

        try {
            const response = await fetch(API_URL + '/api/historial-pago', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                this.audit.log(`Guardó Planilla: ${this.currentMonth.toUpperCase()} ${this.currentYear}`, 'Planilla', `Periodo: ${periodo}`);
                this.notification.success(`✅ Planilla de ${this.currentMonth} ${this.currentYear} guardada correctamente.`);
            } else {
                const err = await response.json();
                this.notification.error('❌ Error al guardar: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error guardando planilla:', error);
            this.notification.error('❌ Error de conexión al guardar la planilla.');
        }
    }

    async resetFields() {
        if (!await this.notification.confirm('¿Desea limpiar todos los campos editables? Los bonos fijos configurados se mantendrán.', 'Reiniciar Planilla')) return;

        try {
            await fetch(API_URL + '/api/planilla-borrador', {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } catch (error) {
            console.error('Error clearing borrador:', error);
        }

        this.employees.forEach(emp => {
            emp.horasExtras = 0;
            emp.montoHorasExtras = 0;
            emp.adelanto = 0;
            emp.prestamo = 0;
            emp.faltasDias = 0;
            emp.faltasHoras = 0;
            emp.descuentoAdicional = 0;
            (emp as any).descuentosAdicionales = [];
            emp.observaciones = '';
            emp.estado = 'PENDIENTE';

            // Keep only permanent bonuses, remove single-month ones
            const permanentBonos = (emp.bonosDetalle || []).filter((b: any) => b.permanente === true);
            emp.bonosDetalle = permanentBonos;
            emp.bonos = permanentBonos.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

            this.calculateEmployee(emp, true);
        });

        this.audit.log('Limpió campos editables de la planilla', 'Planilla');
        this.notification.success('✅ Campos limpiados. Los bonos fijos se mantuvieron.');
    }

    // Modal Logic
    showDeductionModal: boolean = false;
    deductionDetail: any = {
        title: '',
        sueldo: 0,
        valorUnitario: 0,
        cantidad: 0,
        total: 0,
        type: '' // 'DIA' or 'HORA'
    };

    openDeductionModal(emp: PayrollEmployee, type: 'DIA' | 'HORA') {
        const sueldo = emp.sueldo || 0;
        const valorDia = sueldo / 30;
        const valorHora = valorDia / 8;

        this.deductionDetail = {
            title: type === 'DIA' ? 'Descuento por Días de Falta' : 'Descuento por Horas de Falta',
            empName: `${emp.nombre} ${emp.apellidos}`,
            sueldo: sueldo,
            baseCalculo: sueldo, // Changed to show only base salary in the modal too
            type: type,
            valorUnitario: type === 'DIA' ? valorDia : valorHora,
            cantidad: type === 'DIA' ? (emp.faltasDias || 0) : (emp.faltasHoras || 0),
            total: type === 'DIA' ? (valorDia * (emp.faltasDias || 0)) : (valorHora * (emp.faltasHoras || 0)),
            formula: type === 'DIA' ? `S/ ${sueldo} ÷ 30` : `S/ ${valorDia.toFixed(2)} ÷ 8`,
            unrounded: type === 'DIA' ? valorDia : valorHora
        };

        this.showDeductionModal = true;
    }

    closeDeductionModal() {
        this.showDeductionModal = false;
    }

    // Additional Discount Modal
    // Additional Discount Modal
    showAdditionalModal: boolean = false;
    additionalDetail: any = {
        empId: '',
        empName: '',
        cargo: '',
        sueldo: 0,
        items: [], // Array of { motivo, fecha, monto }
        newItem: {
            motivo: '',
            fecha: '',
            monto: 0
        }
    };

    openAdditionalDiscountModal(emp: PayrollEmployee) {
        this.additionalDetail = {
            empId: emp._id,
            empName: `${emp.nombre} ${emp.apellidos}`,
            cargo: emp.cargo,
            sueldo: emp.sueldo,
            items: (emp as any).descuentosAdicionales ? [...(emp as any).descuentosAdicionales] : [],
            newItem: {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0
            }
        };
        this.showAdditionalModal = true;
    }

    addDiscountItem() {
        if (this.additionalDetail.newItem.monto > 0) {
            this.additionalDetail.items.push({ ...this.additionalDetail.newItem });
            // Reset new item
            this.additionalDetail.newItem = {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0
            };
        }
    }

    removeDiscountItem(index: number) {
        this.additionalDetail.items.splice(index, 1);
    }

    saveAdditionalDiscount() {
        const emp = this.employees.find(e => e._id === this.additionalDetail.empId);
        if (emp) {
            // Update array
            (emp as any).descuentosAdicionales = this.additionalDetail.items;

            // Recalculate total
            const total = this.additionalDetail.items.reduce((sum: number, item: any) => sum + item.monto, 0);
            emp.descuentoAdicional = total;

            this.audit.log(`Actualizó descuentos adicionales para: ${emp.nombre} ${emp.apellidos}`, 'Planilla', `Nuevo total: S/ ${emp.descuentoAdicional}`);
            this.calculateEmployee(emp, true); // Calculate and Save
        }
        this.closeAdditionalModal();
    }

    closeAdditionalModal() {
        this.showAdditionalModal = false;
    }

    // Modal de Bonos
    showBonoModal: boolean = false;
    bonoDetail: any = {
        empId: '',
        empName: '',
        cargo: '',
        sueldo: 0,
        items: [],
        newItem: {
            motivo: '',
            fecha: '',
            monto: 0,
            permanente: false
        }
    };

    openBonoModal(emp: PayrollEmployee) {
        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
        const currentMonthIndex = monthNames.findIndex(m => m === this.currentMonth.toLowerCase());

        const itemsFiltrados = (emp.bonosDetalle || []).filter((b: any) => {
            if (b.permanente) return true;
            if (!b.fecha) return false;
            const bd = new Date(b.fecha);
            return bd.getMonth() === currentMonthIndex && bd.getFullYear() === this.currentYear;
        });

        this.bonoDetail = {
            empId: emp._id,
            empName: `${emp.nombre} ${emp.apellidos}`,
            cargo: emp.cargo,
            sueldo: emp.sueldo,
            items: itemsFiltrados,
            newItem: {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0,
                permanente: false
            }
        };
        this.showBonoModal = true;
    }

    addBonoItem() {
        if (this.bonoDetail.newItem.monto > 0) {
            this.bonoDetail.items.push({ ...this.bonoDetail.newItem });
            this.bonoDetail.newItem = {
                motivo: '',
                fecha: new Date().toISOString().split('T')[0],
                monto: 0,
                permanente: false
            };
        }
    }

    removeBonoItem(index: number) {
        this.bonoDetail.items.splice(index, 1);
    }

    saveBonos() {
        const emp = this.employees.find(e => e._id === this.bonoDetail.empId);
        if (emp) {
            const monthNames = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
            ];
            const currentMonthIndex = monthNames.findIndex(m => m === this.currentMonth.toLowerCase());

            // Al guardar: solo conservar bonos permanentes + del mes actual (limpiar meses anteriores del borrador)
            const bonosLimpios = this.bonoDetail.items.filter((b: any) => {
                if (b.permanente) return true;
                if (!b.fecha) return false;
                const bd = new Date(b.fecha);
                return bd.getMonth() === currentMonthIndex && bd.getFullYear() === this.currentYear;
            });

            emp.bonosDetalle = bonosLimpios;
            emp.bonos = bonosLimpios.reduce((sum: number, b: any) => sum + (b.monto || 0), 0);

            this.audit.log(`Actualizó bonos para: ${emp.nombre} ${emp.apellidos}`, 'Planilla', `Nuevo total: S/ ${emp.bonos}`);
            this.calculateEmployee(emp, true);
        }
        this.closeBonoModal();
    }

    closeBonoModal() {
        this.showBonoModal = false;
    }

    get totalNetoAPagar(): number {
        return this.employees.reduce((sum, emp) => sum + (emp.remuneracionNeta || 0), 0);
    }
}
