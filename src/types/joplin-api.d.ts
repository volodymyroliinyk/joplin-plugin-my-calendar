// Мінімальна декларація, щоб TS не лаявся на `import joplin from 'api'`
declare module 'api' {
    const joplin: any;
    export default joplin;
}


