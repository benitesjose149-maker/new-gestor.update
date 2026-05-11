const mssql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

async function test() {
    try {
        await mssql.connect(config);
        const res = await mssql.query("SELECT WHMCS_InvoiceID, Banco, CuentaDebito, MontoBruto, DepositoSalida FROM FINANCE_INVOICES WHERE MONTH(Fecha) = MONTH(GETDATE()) AND YEAR(Fecha) = YEAR(GETDATE())");
        console.table(res.recordset);
    } catch(err) {
        console.error(err);
    } finally {
        mssql.close();
    }
}
test();
