// Libraries
#include <Wire.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <AsyncMqttClient.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_SSD1306.h>

// Wi-Fi & MQTT Config
#define WIFI_SSID      "SUPER-ORCA"
#define WIFI_PASSWORD  "zxcvbnmv"
#define MQTT_HOST      "broker.hivemq.com"
#define MQTT_PORT      1883

#define CMD_TOPIC              "orca/skripsi/cmd"
#define MODE_TOPIC             "orca/skripsi/mode"
#define WEB_TOPIC              "orca/skripsi/web"
#define ESP32_STATUS_TOPIC     "orca/skripsi/esp32/status"

// OLED Display Dimensions
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 32

// Objects
Adafruit_MPU6050 mpu;
AsyncMqttClient mqttClient;
Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// System Variables
bool gestureEnabled = false;
char lastSentCmd = 'S';
bool oledNeedsUpdate = true;

String wifiStatus = "WiFi...";
String mqttStatus = "MQTT...";
String modeStatus = "MODE...";

// Moving Average Filter
const int sampleCount = 10;
int sampleIndex = 0;
float accX_samples[sampleCount], accY_samples[sampleCount], accZ_samples[sampleCount];
float accX_avg = 0, accY_avg = 0, accZ_avg = 0;


// ===== INITIALIZATION HELPERS =====
void initMPU() {
  if (!mpu.begin()) {
    Serial.println("MPU6050 not found");
    while (1) delay(100);
  }
}

void initOLED() {
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED init failed");
    while (1) delay(100);
  }
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
}

void initWiFi() {
  WiFi.onEvent(WiFiEvent);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi... ");
}

void initMQTT() {
  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onMessage(onMqttMessage);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setWill(ESP32_STATUS_TOPIC, 1, true, "offline"); // Last Will and Testament
}


// ===== Wi-Fi EVENT HANDLER =====
void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiStatus = "WiFi OK";
      mqttClient.connect();
      Serial.print("WiFi Connected!\nConnecting to MQTT... ");
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      wifiStatus = "WiFi Lost";
      mqttStatus = "MQTT...";
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      Serial.print("WiFi lost. Reconnecting... ");
      break;
  }
  oledNeedsUpdate = true;
}


// ===== MQTT EVENT HANDLERS =====
void onMqttConnect(bool sessionPresent) {
  mqttStatus = "MQTT OK";

  mqttClient.subscribe(MODE_TOPIC, 0); // Subscribe to MODE topic
  mqttClient.publish(ESP32_STATUS_TOPIC, 0, true, "online"); // Publish online status
  Serial.println("MQTT Connected!");

  oledNeedsUpdate = true; // Refreshed OLED
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  mqttStatus = "MQTT...";
  Serial.println("MQTT Disconnected.");
  oledNeedsUpdate = true;
}

void onMqttMessage(char* topic, char* payload, AsyncMqttClientMessageProperties properties,
                   size_t len, size_t index, size_t total) {
  if (strcmp(topic, MODE_TOPIC) == 0) { // Check received massage from MODE_TOPIC
    String mode = String(payload).substring(0, len);

    gestureEnabled = (mode == "gesture"); // Update flag
    modeStatus = gestureEnabled ? "GESTURE MODE" : "MANUAL MODE"; // Update modeStatus
    Serial.printf("[MODE] %s\n", modeStatus.c_str());

    oledNeedsUpdate = true;
  }
}


// ===== SENSOR DATA PROCESSING =====
void getFilteredData() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  accX_avg -= accX_samples[sampleIndex] / sampleCount;
  accY_avg -= accY_samples[sampleIndex] / sampleCount;
  accZ_avg -= accZ_samples[sampleIndex] / sampleCount;

  accX_samples[sampleIndex] = a.acceleration.x;
  accY_samples[sampleIndex] = a.acceleration.y;
  accZ_samples[sampleIndex] = a.acceleration.z;

  accX_avg += accX_samples[sampleIndex] / sampleCount;
  accY_avg += accY_samples[sampleIndex] / sampleCount;
  accZ_avg += accZ_samples[sampleIndex] / sampleCount;

  sampleIndex = (sampleIndex + 1) % sampleCount;
}

char interpretGesture(float roll, float pitch) {
  if (pitch < -30 && pitch > -90) return 'F';
  if (pitch > 30 && pitch < 90)  return 'B';
  if (roll < -30 && roll > -90)  return 'R';
  if (roll > 30 && roll < 90)    return 'L';
  return 'S';
}


// ===== PUBLISH SENSOR DATA =====
void sendData() {
  getFilteredData();

  float roll  = atan2(accY_avg, accZ_avg) * 180 / PI;
  float pitch = atan2(-accX_avg, accZ_avg) * 180 / PI;

  // ---- Send Gesture Command ----
  if (gestureEnabled) {
    char cmd = interpretGesture(roll, pitch);
    if (cmd != lastSentCmd || (cmd != 'S' && lastSentCmd != 'S')) {
      mqttClient.publish(CMD_TOPIC, 0, false, &cmd, 1);
      lastSentCmd = cmd;
    }
  }

  // ---- Send JSON to Dashboard ----
  StaticJsonDocument<64> jsonData;
  jsonData["roll"] = roll;
  jsonData["pitch"] = pitch;

  char payload[64];
  serializeJson(jsonData, payload);
  mqttClient.publish(WEB_TOPIC, 0, false, payload);
}


// ===== OLED DISPLAY UPDATE =====
void updateOledDisplay() {
  oled.clearDisplay();

  int16_t x1, y1; uint16_t w, h; // Calculate position variables

  // Line 1: WiFi Status
  oled.getTextBounds(wifiStatus, 0, 0, &x1, &y1, &w, &h);
  oled.setCursor((SCREEN_WIDTH - w) / 2, 0);
  oled.println(wifiStatus);

  // Line 2: MQTT Status
  oled.getTextBounds(mqttStatus, 0, 0, &x1, &y1, &w, &h);
  oled.setCursor((SCREEN_WIDTH - w) / 2, 10);
  oled.println(mqttStatus);

  // Line 3: MODE Status
  oled.getTextBounds(modeStatus, 0, 0, &x1, &y1, &w, &h);
  oled.setCursor((SCREEN_WIDTH - w) / 2, 20);
  oled.println(modeStatus);

  oled.display();
  oledNeedsUpdate = false; // OLED Updated
}


// ===== CORE FUNCTIONS =====
void setup() {
  Serial.begin(115200);
  initMPU(); initOLED(); initWiFi(); initMQTT(); // Call all initialization functions
  updateOledDisplay();
}

void loop() {
  // Check MQTT connection
  static unsigned long lastReconnect = 0;
  if (!mqttClient.connected() && millis() - lastReconnect > 5000) {
    lastReconnect = millis();
    mqttClient.connect();
  }

  // Send data & Refresh OLED
  sendData();
  if (oledNeedsUpdate) updateOledDisplay();
  delay(15);
}