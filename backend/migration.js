import mssql from 'mssql';
import 'dotenv/config';

const config = {
    user: process.env.SQL_USER || 'sa',
    password: process.env.SQL_PASSWORD || 'TuPasswordFuerte123!',
    server: process.env.SQL_SERVER || '15.235.16.229',
    port: parseInt(process.env.SQL_PORT || '1433'),
    database: 'PLANILLA',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function migrate() {
    try {
        console.log('Connecting to database...');
        const pool = await mssql.connect(config);
        console.log('Running migrations...');

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EMPLOYEES') AND name = 'BIOMETRIC_ID')
                ALTER TABLE EMPLOYEES ADD BIOMETRIC_ID INT;
            
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EMPLOYEES') AND name = 'ENTRY_TIME')
                ALTER TABLE EMPLOYEES ADD ENTRY_TIME VARCHAR(10);
                
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EMPLOYEES') AND name = 'EXIT_TIME')
                ALTER TABLE EMPLOYEES ADD EXIT_TIME VARCHAR(10);
        `);
        console.log('EMPLOYEES table updated.');

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ATTENDANCE_LOGS' AND xtype='U')
            BEGIN
                CREATE TABLE ATTENDANCE_LOGS (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    SN NVARCHAR(50),
                    USERID INT,
                    CHECKTIME DATETIME,
                    CHECKTYPE INT, -- 0: Entrada, 1: Salida, etc.
                    VERIFYCODE INT,
                    SENSORID NVARCHAR(50),
                    CREATED_AT DATETIME DEFAULT GETDATE()
                )
            END
        `);
        console.log('ATTENDANCE_LOGS table created/verified.');

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='BIOMETRIC_USERS' AND xtype='U')
            BEGIN
                CREATE TABLE BIOMETRIC_USERS (
                    PIN INT PRIMARY KEY,
                    NAME NVARCHAR(255),
                    SYNC_DATE DATETIME DEFAULT GETDATE()
                )
            END
        `);
        console.log('BIOMETRIC_USERS table created/verified.');

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ATTENDANCE_DAILY_REPORTS' AND xtype='U')
            BEGIN
                CREATE TABLE ATTENDANCE_DAILY_REPORTS (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    ID_EMPLOYEE INT,
                    DATE DATE,
                    FIRST_ENTRY DATETIME,
                    LAST_EXIT DATETIME,
                    TOTAL_HOURS DECIMAL(10,2),
                    STATUS NVARCHAR(50),
                    CREATED_AT DATETIME DEFAULT GETDATE(),
                    UNIQUE(ID_EMPLOYEE, DATE)
                )
            END
        `);
        console.log('ATTENDANCE_DAILY_REPORTS table created/verified.');

        await pool.close();
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
