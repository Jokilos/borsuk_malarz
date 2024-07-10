// Obsługa serwera WWW w wersji https wymaga starszej wersji środowiska
// programistycznego. Ubocznym skutkiem zastosowania starszej wersji jest
// niedziałająca obsługa mDNS.
//
// https://github.com/platformio/platform-espressif8266/releases/tag/v3.0.0
//
// Przeglądarki internetowe iPhone'ów i iPad'ów udostępniają dane dotyczące
// położenia urządzenia tylko dla stron https.
//
// Paweł Klimczewski, 21 czerwca 2022.

#include <ESP8266WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncElegantOTA.h>
#include <LittleFS.h>
#include <DNSServer.h>

AsyncWebServer http(80), https(443);
AsyncWebSocket ws("/ws");
DNSServer dnsServer;
unsigned long last_command_time = 0;
//---------------------------------------------------------------------------
void onEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
  AwsEventType type, void* arg, uint8_t* data, size_t len)
{
  if (type == WS_EVT_DATA)
  {
    if (len == 3)
    {
      const int8_t* buf = (int8_t*)data;
      // Przeglądarka przesyła dwie liczby jednobajtowe o zakresie wartości
      // [-128..127].  Na podstawie znaków liczb określam kierunki obrotów
      // silników. Trzeci bajt steruje automatycznym zatrzymywaniem pojazdu
      // w przypadku zerwania połączenia.
      bool l_dir = buf[0] < 0, r_dir = buf[1] < 0;
      last_command_time = buf[2] ? millis() : 0;
      // Na podstawie wartości bezwzględnych ustalam prędkości obrotowe
      // silników.  Argumentem funkcji analogWrite jest wartość z zakresu
      // [0..255].  Stąd mnożenie przez 2.
      int16_t l_spd = buf[0], r_spd = buf[1];
      l_spd = 2*(l_spd < 0 ? -l_spd : l_spd);
      r_spd = 2*(r_spd < 0 ? -r_spd : r_spd);
      if (l_spd > 255)
        l_spd = 255;
      if (r_spd > 255)
        r_spd = 255;
      digitalWrite(D0, l_dir);
      analogWrite(D1, l_spd);
      analogWrite(D2, r_spd);
      digitalWrite(D7, !r_dir);
    }
  }
}
//---------------------------------------------------------------------------
void get_heap(AsyncWebServerRequest* request)
{
  char buf[32];
  sprintf(buf, "%d\n", system_get_free_heap_size());
  request->send(200, "text/plain", String(buf));
}
//---------------------------------------------------------------------------
int onCertificate(void* arg, const char* filename, uint8_t** buf)
{
  size_t size = 0;
  *buf = 0;
  File file = LittleFS.open(filename, "r");
  if (file)
  {
    size_t n = file.size();
    if (n>0)
    {
      uint8_t* b = (uint8_t*)malloc(n);
      if (b)
      {
        size = file.read(b, n);
        *buf = b;
      }
    }
    file.close();
  }
  return size;
}
//---------------------------------------------------------------------------
void setup()
{
  pinMode(D0, OUTPUT);
  pinMode(D1, OUTPUT);
  pinMode(D2, OUTPUT);
  pinMode(D7, OUTPUT);
  analogWriteRange(255);

  LittleFS.begin();

  ws.onEvent(onEvent);

  http.addHandler(&ws);
  http.on("/heap", HTTP_GET, get_heap);
  http.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  AsyncElegantOTA.begin(&http);
  http.begin();

  https.addHandler(&ws);
  https.on("/heap", HTTP_GET, get_heap);
  https.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  AsyncElegantOTA.begin(&https);
  https.onSslFileRequest(onCertificate, NULL);
  https.beginSecure("/server.cer", "/server.key", NULL);

  constexpr const byte DNS_PORT = 53;
  dnsServer.start(DNS_PORT, "local", IPAddress(192, 168, 4, 1));

  WiFi.mode(WIFI_AP);
  WiFi.softAP("borsuk", "forbot00");
}
//---------------------------------------------------------------------------
void loop()
{
  if (last_command_time && last_command_time + 500 < millis())
  {
    analogWrite(D1, 0);
    analogWrite(D2, 0);
  }
  ws.cleanupClients();
  dnsServer.processNextRequest();
}
//---------------------------------------------------------------------------
