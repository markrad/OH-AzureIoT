# OH-AzureIoT
Node Red module to take OpenHab MQTT persistence and send it to an Azure IoT Hub.

This is a pretty rough early version. Not yet packaged into NPM.

It expects a stream from the MQTT node that is connected to the OpenHab MQTT persistence. It will convert the data to JSON and send it to an Azure IoT Hub (I use a free one which is adequate for this purpose in my case). The idea being that one can use stream analytics to see temperature graphs for example.
