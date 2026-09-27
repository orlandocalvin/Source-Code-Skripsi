# Source-Code-Skripsi

Source code of my undergraduate thesis: ESP32-C3 and ESP8266 firmware and a web monitoring dashboard. An RC car is driven over MQTT, either from the dashboard or by tilting an MPU6050 gesture controller.

## Contents

| Folder | What it is | Stack |
|---|---|---|
| `esp32c3/` | Gesture controller: reads roll/pitch from an MPU6050, shows status on an OLED and publishes drive commands in gesture mode | ESP32-C3, AsyncMqttClient, MPU6050, SSD1306 |
| `esp8266/` | RC car: subscribes to drive commands and controls the motors, horn and LED | ESP8266, AsyncMqttClient |
| `dashboard-web/` | Web dashboard: manual controls, gesture/manual mode switch, roll/pitch gauges and online status of both devices | HTML, CSS, JS, MQTT.js (WebSocket), gauge.js |

## Running it

1. Open `esp32c3/esp32c3.ino` and `esp8266/esp8266.ino` in the Arduino IDE, install the libraries they include, set `WIFI_SSID` and `WIFI_PASSWORD` at the top of each sketch to your own network, and upload each to its board.
2. Open `dashboard-web/index.html` in a browser. No build step.

All three parts talk through the public HiveMQ broker, so they only need internet access.
