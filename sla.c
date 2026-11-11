#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiUdp.h>
#include "DHT.h"
#include <TinyGPSPlus.h>

// ---- Configure aqui ----
const char* WIFI_NOME  = "NOME_DA_REDE";        // ex.: hotspot do celular
const char* WIFI_SENHA = "SENHA_DA_REDE";
// Deixe vazio: o ESP32 acha sozinho o computador que roda "npm start" na mesma rede.
// Só preencha se a descoberta falhar, ex.: "http://192.168.0.10:8080/api/leituras"
const char* URL_SERVIDOR = "";
const char* SENSOR_ID = "esp32-01";            // um por ponto; igual ao "id" em web/config/pontos.json
const char* CHAVE_API = "";                     // preencha se usar TERMOPOLIV_API_KEY

const unsigned long INTERVALO_ENVIO = 60000;    // ms entre envios; 1 por minuto basta para ponto fixo
const unsigned long INTERVALO_DHT = 2500;       // o DHT22 aceita no máximo 1 leitura a cada 2 s
const unsigned long IDADE_MAXIMA_GPS = 10000;   // posição mais velha que isso não é enviada
const unsigned long IDADE_MAXIMA_DHT = 10000;   // leitura mais velha que isso não é enviada
const uint16_t PORTA_DESCOBERTA = 8099;         // a mesma de web/lib/descoberta.js
const int FALHAS_PARA_REDESCOBRIR = 3;          // o IP do computador pode mudar no hotspot
// -------------------------

DHT dht(15, DHT22);
TinyGPSPlus gps;
WebServer server(80);
WiFiUDP udp;
String urlServidor = "";
int falhasSeguidas = 0;

float temp = NAN, umid = NAN;
unsigned long tDHT = 0, tDebug = 0, tEnvio = 0;
unsigned long tDHTValido = 0;
bool dhtOk = false;
int ultimoStatusEnvio = 0;

const char PAGINA[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TermoPoliv</title></head>
<body style="font-family:sans-serif;text-align:center">
<h1>TermoPoliv</h1>
<h2 id="t">--</h2><h2 id="u">--</h2><p id="g">--</p>
<script>
setInterval(async()=>{
  try{
    const d=await (await fetch('/dados')).json();
    document.getElementById('t').innerText='Temperatura: '+d.temperatura+' °C';
    document.getElementById('u').innerText='Umidade: '+d.umidade+' %';
    document.getElementById('g').innerText = d.lat===undefined
      ? 'GPS: procurando satélites...'
      : 'GPS: '+d.lat+', '+d.lon;
  }catch(e){}
},2000);
</script></body></html>
)rawliteral";

bool gpsValido(){
  return gps.location.isValid() && gps.location.age() < IDADE_MAXIMA_GPS;
}

bool dhtRecente(){
  return tDHTValido > 0 && millis() - tDHTValido < IDADE_MAXIMA_DHT;
}

// Mesmo formato que o servidor espera em POST /api/leituras.
// Sem GPS, lat e lon ficam de fora (o servidor recusa se vier só um dos dois).
String montarJson(){
  String j = "{\"sensor_id\":\"" + String(SENSOR_ID) + "\",";
  j += "\"temperatura\":" + (isnan(temp) ? String("null") : String(temp,1)) + ",";
  j += "\"umidade\":" + (isnan(umid) ? String("null") : String(umid,1));
  if(gpsValido())
    j += ",\"lat\":" + String(gps.location.lat(),6) + ",\"lon\":" + String(gps.location.lng(),6);
  j += "}";
  return j;
}

void dados(){
  server.send(200, "application/json", montarJson());
}

void atualizarDHT(){
  if(millis() - tDHT < INTERVALO_DHT) return;
  tDHT = millis();

  float novaTemp = dht.readTemperature();
  float novaUmid = dht.readHumidity();

  dhtOk = !isnan(novaTemp) && !isnan(novaUmid);
  if(dhtOk){
    temp = novaTemp;
    umid = novaUmid;
    tDHTValido = millis();
  } else {
    Serial.println("Falha ao ler o DHT22; mantendo a ultima leitura valida.");
  }
}

// Pergunta na rede "onde está o TermoPoliv?". O servidor responde
// "TERMOPOLIV <porta>" e o IP dele vem do remetente da resposta.
bool descobrirServidor(){
  if(strlen(URL_SERVIDOR) > 0){ urlServidor = URL_SERVIDOR; return true; }

  udp.begin(PORTA_DESCOBERTA + 1);
  udp.beginPacket(WiFi.broadcastIP(), PORTA_DESCOBERTA);
  udp.print("TERMOPOLIV?");
  udp.endPacket();

  unsigned long inicio = millis();
  while(millis() - inicio < 1000){
    while(Serial2.available()) gps.encode(Serial2.read());  // não perde dados do GPS esperando
    if(udp.parsePacket()){
      char buf[32] = {0};
      udp.read(buf, sizeof(buf) - 1);
      int porta = 0;
      if(sscanf(buf, "TERMOPOLIV %d", &porta) == 1 && porta > 0){
        urlServidor = "http://" + udp.remoteIP().toString() + ":" + String(porta) + "/api/leituras";
        Serial.print("Servidor encontrado: "); Serial.println(urlServidor);
        udp.stop();
        return true;
      }
    }
    delay(10);
  }
  udp.stop();
  Serial.println("Servidor nao encontrado. O \"npm start\" esta rodando na mesma rede?");
  return false;
}

void enviarLeitura(){
  if(millis() - tEnvio < INTERVALO_ENVIO) return;
  tEnvio = millis();

  if(WiFi.status() != WL_CONNECTED){
    Serial.println("Envio: sem Wi-Fi, leitura descartada.");
    return;
  }
  // O servidor recusa temperatura null; e não adianta reenviar um valor velho.
  if(!dhtRecente()){
    Serial.println("Envio: sem leitura recente do DHT22, nada enviado.");
    return;
  }

  if(urlServidor.length() == 0 && !descobrirServidor()) return;

  String j = montarJson();
  HTTPClient http;
  // Timeouts curtos: enquanto o POST espera, o GPS acumula dados no buffer da Serial2.
  http.setConnectTimeout(1500);
  http.setTimeout(1500);
  http.begin(urlServidor);
  http.addHeader("Content-Type", "application/json");
  if(strlen(CHAVE_API) > 0) http.addHeader("X-API-Key", CHAVE_API);
  ultimoStatusEnvio = http.POST(j);

  Serial.print("Envio: "); Serial.print(j);
  Serial.print(" -> ");
  // Erro de conexão (código negativo) repetido: o computador pode ter trocado de IP.
  falhasSeguidas = ultimoStatusEnvio < 0 ? falhasSeguidas + 1 : 0;
  if(falhasSeguidas >= FALHAS_PARA_REDESCOBRIR){
    urlServidor = "";
    falhasSeguidas = 0;
  }
  if(ultimoStatusEnvio == 201) Serial.println("201 gravado");
  else if(ultimoStatusEnvio > 0){
    Serial.print(ultimoStatusEnvio); Serial.print(" "); Serial.println(http.getString());
  } else {
    Serial.print("falhou: "); Serial.println(http.errorToString(ultimoStatusEnvio));
  }
  http.end();
}

void setup(){
  Serial.begin(115200);
  Serial2.setRxBufferSize(2048);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_NOME, WIFI_SENHA);
  Serial.print("Conectando ao Wi-Fi");
  unsigned long inicio = millis();
  while(WiFi.status() != WL_CONNECTED && millis() - inicio < 15000){
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if(WiFi.status() == WL_CONNECTED){
    Serial.print("Conectado. Pagina local: http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi nao conectou ainda; vai tentar de novo sozinho.");
  }

  server.on("/", [](){ server.send(200, "text/html", PAGINA); });
  server.on("/dados", dados);
  server.begin();
}

void loop(){
  while(Serial2.available()) gps.encode(Serial2.read());
  server.handleClient();

  atualizarDHT();
  enviarLeitura();

  if(millis()-tDebug > 3000){
    tDebug = millis();
    Serial.print("GPS: "); Serial.print(gpsValido() ? "OK" : "sem posicao");
    Serial.print(" | satelites: "); Serial.print(gps.satellites.value());
    Serial.print(" | erros: "); Serial.print(gps.failedChecksum());
    Serial.print(" | DHT: "); Serial.print(dhtOk ? "OK" : "FALHA");
    Serial.print(" | Wi-Fi: "); Serial.print(WiFi.status() == WL_CONNECTED ? "OK" : "desconectado");
    Serial.print(" | ultimo envio: "); Serial.println(ultimoStatusEnvio);
  }
}
