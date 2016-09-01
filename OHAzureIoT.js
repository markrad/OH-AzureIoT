'use strict'

var request = require('request');
var util = require('util');
var Registry = require('azure-iothub').Registry;
var waterfall = require('async-waterfall');

module.exports = function(RED) {
	
	var node = null;
	var devices = {};
	var openhabUrl;
	var iotHubName;
	var devicePrefix;			// Not actually sure if this is a good idea or not - not yet implemented
	var addTimestamp;


	var Message = require('azure-iot-device').Message;
	var clientFromConnectionString = require('azure-iot-device-amqp').clientFromConnectionString;
	
	var getSAS = function(device) {
		
		//HostName=OHHub.azure-devices.net;DeviceId=OpenHab1;SharedAccessKey=

		return 'HostName=' + iotHubName + ';DeviceId=' + device.deviceId + ';SharedAccessKey=' + device.connectionString;
	}

	var getDevice = function(msg) {
		
		var index = msg.payload.indexOf(':');
		
		if (index > 0) {
			return msg.payload.substr(0, index);
		}
		else {
			return null;
		}
	};
	
	var getDeviceState = function(msg) {
		
		var index = msg.payload.indexOf(':') + 1;
		
		if (index < msg.payload.length) {
			return msg.payload.substr(index)
		}
		else {
			return null;
		}
	};
	
	var getDeviceType = function(deviceId) {
		
		if (devices[deviceId] === undefined) {
			return null;
		}
		else {
			return devices[deviceId].type;
		}
	};
	
	var fixData = function(data) {
		
		if (data.deviceType == 'DateTimeItem') {
			
			var re = /\[time=(\d*),/;
			
			//node.log('---------------------------------------------------------------------');
			//node.log('data.deviceState=' + data.deviceState);
			
			var result = re.exec(data.deviceState);
			
			//node.log('result=' + util.inspect(result));
			//node.log('result[0]=' + result[0] + '; result[1]=' + result[1]);
			var jsDate = new Date(parseInt(result[1], 10));
			
			//node.log('jsDate=' + jsDate);
			
			data.deviceState = jsDate;
		}
		
		return data;
	}
	
	var sendMessage = function(deviceId, deviceState, callback) {
		
		waterfall([
			// Look for the device in the hashtable. If it's not there add it.
			function(callback) {
				if (devices[deviceId] !== undefined) {
					callback(null, devices[deviceId])
				}
				else {
					var itemsUrl = openhabUrl + '/rest/items/' + deviceId + '?type=json';
				
					request(itemsUrl, function(err, response, body) {
						
						if (err == null && response.statusCode == 200) {
							
							var item = JSON.parse(body);
							
							devices[deviceId] = { deviceId: deviceId, type: item.type };
							callback(null, devices[deviceId]);
						}
						else {
							callback(err, null);
							node.log("Failed to acquire OpenHab items: " + err + ' ' + response.statusCode);
						}
					});
				}
			},
			// Make sure we have a primary key
			function(device, callback) {
				if (device.connectionString !== undefined) {
					callback(null, device)
				}
				else {
					getDeviceConnectionString(device, function(err, primaryKey) {
						
						if (err != null) {
							callback(err, null);
						}
						else {
							device.connectionString = primaryKey;
							callback(null, device);
						}
					});
				}
			},
			// Make sure we have an open connection
			function(device, callback) {
				if (device.client !== undefined) {
					callback(null, device);
				}
				else {
					device['client'] = clientFromConnectionString(getSAS(device));
					
					device.client.open(function(err) {
						
						if (err != null) {
							node.status({fill: "red", shape: "ring", text: "disconnected"});
						}
						else {
							node.status({fill: "green", shape: "dot", text: "connected"});
						}
						callback(err, device);
					});
					
				}
			}, 
			// Send the message to the IoT hub
			function(device, callback) {
				
				var data = { deviceId: device.deviceId, deviceState: deviceState, deviceType: device.type};
				
				if (addTimestamp == 'yes') {
					data['timestamp'] = new Date();
				}
				
				data = fixData(data);
				
				var jsonData = JSON.stringify(data);
				var message = new Message(jsonData);
				
				node.log('sending: data=' + util.inspect(jsonData));

				device.client.sendEvent(message, printResultFor('send'));
				
				callback(null, data);
			}
		], function(err, result) {
			callback(err, result);
		});
	};
	
	function printResultFor(op) {
		return function printResult(err, res) {
			
			if (err) node.log(op + ' error: ' + err.toString());
			if (res) node.log(op + ' status: ' + res.constructor.name);
		};
	}

	var getDeviceConnectionString = function(device, callback) {
		
		var registry = Registry.fromConnectionString(node.credentials.connectionString);
				
		registry.create(device, function(err, regDevice, response) {
					
			if (err) {
				if (err.message != 'Conflict') {
					node.log('getDeviceConnectionString: Device creation failed: ' + err.message);
					node.log('getDeviceConnectionString: ' + JSON.stringify(device));
			
					if (callback) {
						callback(err, null);
					}
				}
				else {
					registry.get(device.deviceId, function(err, regDevice, ignore) {
						
						if (err != null) {
							node.log('getDeviceConnectionString: Device acquisition failed: ' + err.message);
							
							if (callback) {
								callback(err, null);
							}
						}
						else {
							if (callback) {
								callback(null, regDevice.authentication.SymmetricKey.primaryKey);
							}
						}
					});
				}
			}
			else {
				if (callback) {
					callback(null, device.authentication.SymmetricKey.primaryKey);
				}
			}
		});
	};
	
    function LowerCaseNode(config) {
        RED.nodes.createNode(this, config);
        node = this;
		
		openhabUrl = config.openhabUrl || 'http://localhost:8080';
		iotHubName = config.iotHubName || '';
		devicePrefix = config.devicePrefix || '';
		addTimestamp = config.addTimestamp || 'yes';
		
		var itemsUrl = openhabUrl + '/rest/items?type=json';
		node.log("itemsUrl=" + itemsUrl);
		
		node.status({fill: "grey", shape: "ring", text: "idle"});

		request(itemsUrl, function(err, response, body) {
			
			if (err == null && response && response.statusCode == 200) {
				
				var items = JSON.parse(body);
				
				for (var index in items.item) {
					devices[items.item[index].name] = { deviceId: items.item[index].name, type: items.item[index].type };
				}
				
				node.log("Found " + Object.keys(devices).length + " devices"); 
				//node.log(util.inspect(devices));
			}
			else {
				node.log("Failed to acquire OpenHab items: " + err);
			}
		});

		this.on('input', function(msg) {
			var deviceId = getDevice(msg);
			var deviceState = getDeviceState(msg);
			
			sendMessage(deviceId, deviceState, function(err, sentMsg) {
				if (err != null) {
					node.log("Failed to send message - TODO need to set status and stuff " + err.message);
				}
				else {
					msg.payload = sentMsg;
					node.send(msg);
				}
			});
        });
		
		this.on('close', function(done) {
			
			var deviceCount = Object.keys(devices).length;
			
			if (deviceCount == 0) {
				node.log('Azure IoT hub connections closed');
				done();
			}

			node.log('Closing Azure IoT hub connections (' + deviceCount + ')');
			
			for (var index in devices)
			{
				var closeDevice = function(device) {
					
					if (device.client !== undefined) {
						device.client.close(function(err, result) {
						
							if (err) {
								node.log('Failed to close connection for device ' + device.deviceId);
							}
							else {
								node.log('Closed device ' + device.deviceId);
							}

							if (--deviceCount == 0) {
								node.log('Azure IoT hub connections closed');
								done();
							}
						});
					}
					else {
						if (--deviceCount == 0) {
							node.log('Azure IoT hub connections closed');
							done();
						}
					}
				};
				
				closeDevice(devices[index]);
			}
		});
    }
	
    RED.nodes.registerType("OH-AzureIoT", LowerCaseNode, {
        credentials: {
            connectionString: { type: "text" }
        },
        defaults: {
            name: { value: "OpenHab to Azure IoT" },
        }
    });
}
