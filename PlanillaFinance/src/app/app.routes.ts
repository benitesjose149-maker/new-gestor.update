import { Routes } from '@angular/router';
import { LoginComponent } from './login/login';
import { DashboardComponent } from './dashboard/dashboard';
import { GestionEmpleadosComponent } from './employees/employees';
import { ArchivedEmployeesComponent } from './archived-employees/archived-employees';
import { LayoutComponent } from './layout/layout';

import { PlanillaComponent } from './planilla/planilla';
import { MovimientosComponent } from './Movements/movements';

import { HistorialPagoComponent } from './historial-pago/historial-pago';
import { FinanceDashboardComponent } from './finance-dashboard/finance-dashboard';
import { SettingsPermissionsComponent } from './settings/settings-permissions';
import { authGuard } from './auth/auth.guard';
import { VacationsComponent } from './vacations/vacations';
import { AttendanceComponent } from './attendance/attendance';
import { WhmcsHistoryComponent } from './whmcs-history/whmcs-history';
export const routes: Routes = [
    { path: 'login', component: LoginComponent },
    {
        path: '',
        component: LayoutComponent,
        canActivate: [authGuard],
        children: [
            { path: 'dashboard', component: DashboardComponent, title: 'Dashboard | HWPeru' },
            { path: 'employees', component: GestionEmpleadosComponent, title: 'Empleados | HWPeru' },
            { path: 'archived-employees', component: ArchivedEmployeesComponent, title: 'Emp. Archivados | HWPeru' },
            { path: 'planilla', component: PlanillaComponent, title: 'Planilla | HWPeru' },
            { path: 'movements', component: MovimientosComponent, title: 'Movimientos | HWPeru' },
            { path: 'historial-pago', component: HistorialPagoComponent, title: 'Consultas | HWPeru' },
            { path: 'finance', component: FinanceDashboardComponent, title: 'Control Financiero | HWPeru' },
            { path: 'whmcs-history', component: WhmcsHistoryComponent, title: 'Historial Factura | HWPeru' },
            { path: 'vacations', component: VacationsComponent, title: 'Vacaciones | HWPeru' },
            { path: 'settings', component: SettingsPermissionsComponent, title: 'Configuración | HWPeru' },
            { path: 'attendance', component: AttendanceComponent, title: 'Asistencia | HWPeru' },
            { path: '', redirectTo: '/login', pathMatch: 'full' },
        ]
    }
];
