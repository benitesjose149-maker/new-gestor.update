import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
    selector: 'app-proveedores',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './proveedores.html',
    styleUrls: ['./proveedores.css'],
})
export class ProveedoresComponent {
    constructor() { }
}