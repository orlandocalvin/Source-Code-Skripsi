// ===== LIBRARIES =====
#include <ESP8266WiFi.h>
#include <AsyncMqttClient.h>


// ===== WIFI & MQTT CONFIGURATION =====
#define WIFI_SSID          "SUPER-ORCA"
#define WIFI_PASSWORD      "zxcvbnmv"
#define MQTT_HOST          "broker.hivemq.com"
#define MQTT_PORT          1883
#define CMD_TOPIC          "orca/skripsi/cmd"
#define CAR_STATUS_TOPIC   "orca/skripsi/car/status"


// ===== HARDWARE PIN DEFINITION =====
const int LEFT_GAS  = D1;
const int RIGHT_GAS = D2;
const int LEFT_DIR  = D3;
const int RIGHT_DIR = D4;
const int buzPin    = D5;
const int ledPin    = D8;


// ===== GLOBAL VARIABLES & OBJECTS =====
AsyncMqttClient mqttClient;
unsigned long hornEndTime = 0;


// ===== MQTT EVENT HANDLERS =====
void onMqttConnect(bool sessionPresent) {
  Serial.println("Connected to MQTT!");
  mqttClient.subscribe(CMD_TOPIC, 0);
  mqttClient.publish(CAR_STATUS_TOPIC, 0, true, "online");
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.println("Disconnected from MQTT.");
}

void onMqttMessage(char* topic, char* payload, AsyncMqttClientMessageProperties properties,
                   size_t len, size_t index, size_t total) {
  if (len == 1) {
    char cmd = payload[0];
    Serial.printf("Executing command: %c\n", cmd);
    executeCommand(cmd);
  }
}


// ===== COMMAND EXECUTION =====
void executeCommand(char cmd) {
  switch (cmd) {
    case 'F': Forward(); break;
    case 'B': Backward(); break;
    case 'L': TurnLeft(); break;
    case 'R': TurnRight(); break;
    case 'S': Stop(); break;
    case 'V': BeepHorn(); break;
    case 'W': TurnLightOn(); break;
    case 'w': TurnLightOff(); break;
  }
}


// ===== INITIALIZATION =====
void initHardware() {
  pinMode(buzPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  pinMode(RIGHT_GAS, OUTPUT);
  pinMode(LEFT_GAS, OUTPUT);
  pinMode(RIGHT_DIR, OUTPUT);
  pinMode(LEFT_DIR, OUTPUT);

  digitalWrite(buzPin, LOW);
  digitalWrite(ledPin, LOW);
  digitalWrite(RIGHT_GAS, LOW);
  digitalWrite(LEFT_GAS, LOW);
  digitalWrite(RIGHT_DIR, LOW);
  digitalWrite(LEFT_DIR, LOW);
}


// ===== DEVICE ACTIONS =====
void Throttle(int gas) { digitalWrite(RIGHT_GAS, gas); digitalWrite(LEFT_GAS, gas); }
void Forward() { digitalWrite(RIGHT_DIR, HIGH); digitalWrite(LEFT_DIR, HIGH); Throttle(HIGH); }
void Backward() { digitalWrite(RIGHT_DIR, LOW); digitalWrite(LEFT_DIR, LOW); Throttle(HIGH); }
void TurnRight() { digitalWrite(RIGHT_DIR, LOW); digitalWrite(LEFT_DIR, HIGH); Throttle(HIGH); }
void TurnLeft() { digitalWrite(RIGHT_DIR, HIGH); digitalWrite(LEFT_DIR, LOW); Throttle(HIGH); }
void Stop() { Throttle(LOW); delay(500); }
void BeepHorn() { digitalWrite(buzPin, HIGH); hornEndTime = millis() + 150; }
void TurnLightOn() { digitalWrite(ledPin, HIGH); }
void TurnLightOff() { digitalWrite(ledPin, LOW); }


// ===== CORE FUNCTIONS =====
void setup() {
  Serial.begin(74880);
  initHardware();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onMessage(onMqttMessage);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setWill(CAR_STATUS_TOPIC, 1, true, "offline"); // Last Will and Testament

  Serial.println("Connecting to WiFi & MQTT...");
}

void loop() {
  // Check MQTT connection
  static unsigned long lastReconnect = 0;
  if (!mqttClient.connected() && millis() - lastReconnect > 5000) {
    lastReconnect = millis();
    mqttClient.connect();
  }

  // Turn off the horn
  if (hornEndTime > 0 && millis() >= hornEndTime) {
    digitalWrite(buzPin, LOW);
    hornEndTime = 0;
  }
}