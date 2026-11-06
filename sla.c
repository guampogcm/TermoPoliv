#include <WiFi.h>
#include <WebServer.h>
#include "DHT.h"
#include <TinyGPSPlus.h>

DHT dht(15, DHT22);
TinyGPSPlus gps;
WebServer server(80);

float temp = NAN, umid = NAN;
unsigned long tDHT = 0, tDebug = 0;
unsigned long tDHTValido = 0;
bool dhtOk = false;

const unsigned long INTERVALO_DHT = 2500;
const unsigned long IDADE_MAXIMA_GPS = 10000;

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
    document.getElementById('g').innerText = d.latitude===null
      ? 'GPS: procurando satélites...'
      : 'GPS: '+d.latitude+', '+d.longitude;
  }catch(e){}
},2000);
</script></body></html>
)rawliteral";

void dados(){
  String j = "{\"device_id\":\"TERMOPOLIV-CAR-01\",";
  j += "\"temperatura\":" + (isnan(temp) ? String("null") : String(temp,1)) + ",";
  j += "\"umidade\":" + (isnan(umid) ? String("null") : String(umid,1)) + ",";
  if(gps.location.isValid() && gps.location.age() < IDADE_MAXIMA_GPS)
    j += "\"latitude\":" + String(gps.location.lat(),6) + ",\"longitude\":" + String(gps.location.lng(),6);
  else
    j += "\"latitude\":null,\"longitude\":null";
  j += "}";
  server.send(200, "application/json", j);
}

void atualizarDHT(){
  if(millis() - tDHT < INTERVALO_DHT) return;
  tDHT = millis();

  float novaTemp = dht.readTemperature();
  float novaUmid = dht.readHumidity();

  Serial.print("DHT22 -> temperatura: ");
  Serial.print(novaTemp);
  Serial.print(" C | umidade: ");
  Serial.print(novaUmid);
  Serial.println(" %");

  dhtOk = !isnan(novaTemp) && !isnan(novaUmid);
  if(dhtOk){
    temp = novaTemp;
    umid = novaUmid;
    tDHTValido = millis();
  } else {
    Serial.println("Falha ao ler o DHT22; mantendo a ultima leitura valida.");
  }
}

void setup(){
  Serial.begin(115200);
  Serial2.setRxBufferSize(2048);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  dht.begin();
  WiFi.softAP("TermoPoliv", "12345678");
  server.on("/", [](){ server.send(200, "text/html", PAGINA); });
  server.on("/dados", dados);
  server.begin();
  Serial.println(WiFi.softAPIP());
}

void loop(){
  while(Serial2.available()) gps.encode(Serial2.read());
  server.handleClient();

  atualizarDHT();

  if(millis()-tDebug > 3000){
    tDebug = millis();
    Serial.print("GPS chars: "); Serial.print(gps.charsProcessed());
    Serial.print(" | satelites: "); Serial.print(gps.satellites.value());
    Serial.print(" | erros: "); Serial.print(gps.failedChecksum());
    Serial.print(" | DHT: "); Serial.print(dhtOk ? "OK" : "FALHA");
    if(tDHTValido > 0){
      Serial.print(" | ultima leitura valida ha ");
      Serial.print((millis() - tDHTValido) / 1000);
      Serial.print("s");
    }
    Serial.println();
  }
}