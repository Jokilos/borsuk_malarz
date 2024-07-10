'use strict';

const eps = 0.001; // epsilon
const debug = false; // true, gdy uruchamiamy stronę na komputerze w celach testowych
let ws;
let borsuk;
let fileReady = false;
let cmds;

// Inicjalizacja web socketa, kod zapożyczony z istniejącego projektu.
function initWebSocket()
{
    ws = new WebSocket(
        (document.location.protocol == 'https:' ? 'wss://' : 'ws://')
        + window.location.hostname + '/ws')
    ws.addEventListener('close', function ()
    {
        setTimeout(initWebSocket, 1000)
    });
}

// Po załadowaniu strony inicjowany webSocket i tworzony obiekt klasy
// `Borsuk` do którego będą wysyłane komendy.
window.addEventListener('load', function (event)
{
    borsuk = new Borsuk();
    if(!debug)
        initWebSocket();
});

// Wczytywanie pliku użytkownika.
document.getElementById('fileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
    
        reader.onload = function(e) {
            const content = e.target.result;
            cmds = parseFileContent(content);
        };
    
        reader.readAsText(file);
    }
});

// Jeśli poprawnie wczytano plik rozpoczynamy rysowanie.
// Wyłączanie event listenera, aby nie uniknąć sytuacji,
// gdzie rysujemy ten sam rysunek podwójnie.
async function startDrawing(){
    document.getElementById('start').removeEventListener('click', startDrawing);

    if(fileReady){
        infoDisplay("Rozpoczynanie rysowania!", false);
        await runCommands(cmds);

        if(fileReady)
            infoDisplay("Zakończono rysowanie.", false);
    }

    document.getElementById('start').addEventListener('click', startDrawing);
}

document.getElementById('start').addEventListener('click', startDrawing);

// Event listener na przycisku do przerwania rysowania.
document.getElementById('stop').addEventListener('click', function(event) {
    borsuk.sendStop();
    infoDisplay("Przerwano rysowanie! Aby rozpocząć od nowa, wczytaj ponownie plik.", true);
    fileReady = false;
});

// Wyświetla informacje o obecnym stanie aplikacji w interfejsie użytkownika.
function infoDisplay(text, is_error){
    var info = document.getElementById('info');
    info.textContent = text;

    if(!is_error){
        info.style.color = 'green';
    }
    else{
        info.style.color = 'red';
    }
}

// Wczytywanie zawartości pliku.
function parseFileContent(content) {
    // Dzielimy plik na linie.
    const lines = content.split('\n');
    let cmds = [];

    try{
        cmds = parseFile(lines);
        fileReady = true;
        infoDisplay('Plik gotowy!', false);
    }
    catch(error){
        infoDisplay(error.toString(), true);
    }

    return cmds;
}

// Uruchomienie ciągu sparsowanych komend.
async function runCommands(cmds){
    let state = new State();
    for (const cmd of cmds){
        if(fileReady)
            await state.performCommand(cmd);
        else
            break;
        
        // Przerwa pomiędzy poszczególnymi komendami.
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// komendy:
// x y lineto - poprowadź linię do punku (x, y)
// x y rlineto - poprowadź linię oddaloną o (x, y) od obecnego punktu
// phi r rlinerot - obróć o kąt phi [0, 359] i pojedź do przodu o r

// Klasa emulująca 'enum' dla typów komend.
const CommandName = {
    LINETO : 1,
    RLINETO : 2,
    RLINEROT : 3,
};

// W każdej linii powinny być 3 argumenty, bo w każdej
// linii powinna się znajdować jedna komenda.
const ARGS = 3;

// Klasa odpowiedzialna za trzymanie informacji związanych z pojedynczą komendą.
class Command {
    // Konstruktor przyjmuje pojedynczą linię pliku.
    constructor(line, lineNo) {
        // Dzielimy na ciągi znaków i usuwamy te puste.
        let values = line.split(' ');
        values = values.filter(str => str != '');
        
        if(values.length != ARGS){
            throw new Error(`Nieprawidłowa ilość argumentów w linii ${lineNo}.`);
        }
        
        // Komenda składa się z nazwy i dwóch wartości liczbowych.
        this.cname = this.stringToCmdName(values[2]);
        this.coords = [parseInt(values[0]), parseInt(values[1])];

        if (isNaN(this.coords[0]) || isNaN(this.coords[1])){
            throw new Error(`Nieprawidłowe wartości liczbowe w linii ${lineNo}`);
        }
    }

    stringToCmdName(str){
        switch(str){
            case 'lineto':
                return CommandName.LINETO;
            case 'rlineto':
                return CommandName.RLINETO;
            case 'rlinerot':
                return CommandName.RLINEROT;
            default:
                throw new Error("Nieznana komenda w pliku.");
        }
    }

    toString(){
        return `command ${this.cname}: ${this.coords}\n`;
    }
};

// Funkcja odpowiedzialna za zmianę pliku w ciąg komend.
function parseFile(lines) {
    let cmds = [];
        
    for (const index in lines) {
        cmds.push(new Command(lines[index], + index + 1));
    }

    return cmds;
}

// Normalizuje kąt, tak aby należał do przedziału [0, 2 * pi).
function normalizeAngle(angle) {
    var retval = angle - Math.floor(angle / (2 * Math.PI)) * (2 * Math.PI);

    if(retval > eps)
        return retval;
    else
        return 0;
}

// Klasa odpowiadająca za przechowywanie danych dotyczących obecnego
// stanu rysunku.
class State {
    constructor() {
        // punkt startowy 
        this.currentPoint = [0, 0];
        // kąt startowy, zakładamy, że robot jest ustawiony 'w górę' kartki
        this.currentAngle = Math.PI / 2;
    }

    // Operacja dodawania i odejmowania wektorów.
    coordsOp(c1, c2, op){
        let [x1, y1] = c1;
        let [x2, y2] = c2;

        switch(op){
            case '+':
                return [x1 + x2, y1 + y2];
            case '-':
                return [x1 - x2, y1 - y2];
        }
    }

    // Liczy odległość pomiędzy dwoma punktami.
    length(c1, c2){
        let [x1, y1] = this.coordsOp(c2, c1, '-');

        return Math.sqrt ((x1 * x1) + (y1 * y1));
    }

    // Przekształca współrzędne z układu kartezjańskiego do
    // współrzędnych w układzie biegunowym.
    getPhiR(point){
        let [dx, dy] = point

        let r = Math.sqrt ((dx * dx) + (dy * dy));
        let phi = 0;
        
        if (r > eps){
            // Wyliczenie kąta z wzoru cosinusów.
            const c = this.length([dx, dy], [r, 0]);
            const cos_phi = 1 - ((c * c) / (2 * r * r));
            phi = Math.acos (cos_phi);
            
            if (dy < -eps)
                phi = (2. * Math.PI - phi)
        }
        
        return [phi, r];
    }
    
    // Funkjca odpowiadająca za naniesienie komendy na rysunek.
    async performCommand(cmd) {
        let r = 0, phi = 0, dx = 0, dy = 0;
        
        switch(cmd.cname){
            case CommandName.LINETO:
                // Obliczenie wektora przesunięcia.
                [dx, dy] = this.coordsOp(cmd.coords, this.currentPoint, '-');
                [phi, r] = this.getPhiR([dx, dy]);
                break;

            case CommandName.RLINETO:
                [dx, dy] = cmd.coords;
                [phi, r] = this.getPhiR([dx, dy]);
                break;

            case CommandName.RLINEROT:
                [phi, r] = cmd.coords;
                // Zamiana ze stopni w radiany.
                phi = (phi * 2 * Math.PI) / 360;
                [dx, dy] = [r * Math.cos(phi), r * Math.sin(phi)];
                break;
        }
        var dphi = normalizeAngle(phi - this.currentAngle);
        
        // Wysłanie poleceń do robota.
        await borsuk.turnByPhi(dphi);
        await borsuk.goForward(r);
        
        // Aktualizacja parametrów rysunku.
        this.currentPoint = this.coordsOp(this.currentPoint, [dx, dy], '+');
        this.currentAngle = phi;
    }

};

// Klasa odpowiedzialna za komunikację z robotem.
class Borsuk{
    // Wysłanie polecenia jazdy do przodu z odpowiednią mocą
    // lewego i prawego silnika.
    async sendGo(sl, sr){
        if(debug)
            console.log(`engines l ${sl}, r ${sr}`);
        
        if (!isNaN(sl) && !isNaN(sr) && fileReady)
        {
            try
            {
                const buf = new Int8Array(3);
                buf[0] = sl; // Prędkość lewego silnika.
                buf[1] = sr; // Prędkość prawego silnika.
                buf[2] = 0;  // Bez automatycznego zatrzymania silników.
                if(!debug) 
                    ws.send(buf);
            }
            catch (error)
            {
                window.location.reload();
            }
        }
    }
    
    // Wysłanie komendy zatrzymania.
    async sendStop(){
        this.sendGo(0, 0);
    }

    // Sprawdzenie w którą stronę bardziej opłaca się obrócić.
    checkSide(phi){
        if (phi <= Math.PI)
            return [false, phi];
        else
            return [true, 2 * Math.PI - phi];
    }
    
    // Próba obrotu robota wokół osi pisaka o kąt zaokrąglony do pi/2.
    // Najpierw robot podjeżdża 'do przodu' i skręca w jedną stronę.
    // Potem zawraca wykonując przeciwnie wgięty łuk.
    async turnByPhi(phi){
        var [clockwise, dphi] = this.checkSide(phi);

        if(debug)
            console.log(`turn cw: ${clockwise} by ${dphi}`);

        const value = 15, time = 1300;
        const turns = Math.round(2 * dphi / Math.PI);
        
        if(clockwise){
            var mul1 = 2, mul2 = 1;
        }
        else{
            var mul1 = 1, mul2 = 2;
        }
        
        // jeden obrót o pi/2
        for (let i = 0; i < turns; i++) {
            await this.sendGo(-mul1 * value, -mul2 * value);
            await new Promise(resolve => setTimeout(resolve, time));
            await this.sendGo(mul2 * value, mul1 * value);
            await new Promise(resolve => setTimeout(resolve, time));
        }
        await this.sendStop();
    }

    // Polecenie jazdy do przodu z określoną prędkością.
    // Czas jazdy przekłada się na długość linii.
    async goForward(distance){
        const value = 15, base_time = 200;
        const time = base_time * distance;

        if(debug)
            console.log(`go forward for ${distance}`);

        await this.sendGo(-value, -value);
        await new Promise(resolve => setTimeout(resolve, time));
        await this.sendStop();
    }
}