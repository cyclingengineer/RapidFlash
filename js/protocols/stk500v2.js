/*
    [MESSAGE_START 1b][SEQUENCE_NUMBER 1b][MESSAGE_SIZE 2b, MSB first][TOKEN 1b][MESSAGE_BODY 0-65535b][CHECKSUM 1b]
    
    CHECKSUM = Uses all characters in message including MESSAGE_START and MESSAGE_BODY, XOR of all bytes
*/

var STK500v2_protocol = function() {
    this.hex; // ref

    this.bytes_flashed;
    this.bytes_verified;
    
    this.message = {
        MESSAGE_START:              0x1B,
        TOKEN:                      0x0E,
        ANSWER_CKSUM_ERROR:         0xB0
    };
    
    this.command = {
        CMD_SIGN_ON:                0x01,
        CMD_SET_PARAMETER:          0x02,
        CMD_GET_PARAMETER:          0x03,
        CMD_SET_DEVICE_PARAMETERS:  0x04,
        CMD_OSCCAL:                 0x05,
        CMD_LOAD_ADDRESS:           0x06,
        CMD_FIRMWARE_UPGRADE:       0x07,
        
        CMD_ENTER_PROGMODE_ISP:     0x10,
        CMD_LEAVE_PROGMODE_ISP:     0x11,
        CMD_CHIP_ERASE_ISP:         0x12,
        CMD_PROGRAM_FLASH_ISP:      0x13,
        CMD_READ_FLASH_ISP:         0x14,
        CMD_PROGRAM_EEPROM_ISP:     0x15,
        CMD_READ_EEPROM_ISP:        0x16,
        CMD_PROGRAM_FUSE_ISP:       0x17,
        CMD_READ_FUSE_ISP:          0x18,
        CMD_PROGRAM_LOCK_ISP:       0x19,
        CMD_READ_LOCK_ISP:          0x1A,
        CMD_READ_SIGNATURE_ISP:     0x1B,
        CMD_READ_OSCCAL_ISP:        0x1C,
        CMD_SPI_MULTI:              0x1D,
        
        CMD_ENTER_PROGMODE_PP:      0x20,
        CMD_LEAVE_PROGMODE_PP:      0x21,
        CMD_CHIP_ERASE_PP:          0x22,
        CMD_PROGRAM_FLASH_PP:       0x23,
        CMD_READ_FLASH_PP:          0x24,
        CMD_PROGRAM_EEPROM_PP:      0x25,
        CMD_READ_EEPROM_PP:         0x26,
        CMD_PROGRAM_FUSE_PP:        0x27,
        CMD_READ_FUSE_PP:           0x28,
        CMD_PROGRAM_LOCK_PP:        0x29,
        CMD_READ_LOCK_PP:           0x2A,
        CMD_READ_SIGNATURE_PP:      0x2B,
        CMD_READ_OSCCAL_PP:         0x2C,
        CMD_SET_CONTROL_STACK:      0x2D,
        
        CMD_ENTER_PROGMODE_HVSP:    0x30,
        CMD_LEAVE_PROGMODE_HVSP:    0x31,
        CMD_CHIP_ERASE_HVSP:        0x32,
        CMD_PROGRAM_FLASH_HVSP:     0x33,
        CMD_READ_FLASH_HVSP:        0x34,
        CMD_PROGRAM_EEPROM_HVSP:    0x35,
        CMD_READ_EEPROM_HVSP:       0x36,
        CMD_PROGRAM_FUSE_HVSP:      0x37,
        CMD_READ_FUSE_HVSP:         0x38,
        CMD_PROGRAM_LOCK_HVSP:      0x39,
        CMD_READ_LOCK_HVSP:         0x3A,
        CMD_READ_SIGNATURE_HVSP:    0x3B,
        CMD_READ_OSCCAL_HVSP:       0x3C
    };
    
    this.status = {
        STATUS_CMD_OK:              0x00,
        STATUS_CMD_TOUT:            0x80,
        STATUS_RDY_BSY_TOUT:        0x81,
        STATUS_SET_PARAM_MISSING:   0x82,
        STATUS_CMD_FAILED:          0xC0,
        STATUS_CKSUM_ERROR:         0xC1,
        STATUS_CMD_UNKNOWN:         0xC9
    };
    
    this.param = {
        PARAM_BUILD_NUMBER_LOW:     0x80,
        PARAM_BUILD_NUMBER_HIGH:    0x81,
        PARAM_HW_VER:               0x90,
        PARAM_SW_MAJOR:             0x91,
        PARAM_SW_MINOR:             0x92,
        PARAM_VTARGET:              0x94,
        PARAM_VADJUST:              0x95,
        PARAM_OSC_PSCALE:           0x96,
        PARAM_OSC_CMATCH:           0x97,
        PARAM_SCK_DURATION:         0x98,
        PARAM_TOPCARD_DETECT:       0x9A,
        PARAM_STATUS:               0x9C,
        PARAM_DATA:                 0x9D,
        PARAM_RESET_POLARITY:       0x9E,
        PARAM_CONTROLLER_INIT:      0x9F
    };
    
    // state machine variables
    this.sequence_number;
    
    this.message_state = 0;
    this.message_size = 0;
    this.message_buffer = [];
    this.message_buffer_i = 0;
    this.message_crc = 0;
};

STK500v2_protocol.prototype.initialize = function() {
    var self = this;
    
    this.sequence_number = 1;
    this.bytes_flashed = 0;
    this.bytes_verified = 0;
    
    serial.onReceive.addListener(function(readInfo) {
        self.read(readInfo);
    });
    
    var retry = 0;
    GUI.interval_add('get_in_sync', function() {
        self.send([self.command.CMD_SIGN_ON]);
        
        if (retry++ >= 5) {
            GUI.interval_remove('get_in_sync');
            GUI.log('Connection to the module <span style="color: red">failed</span>');
            
            serial.disconnect(function(result) {
                if (result) { // All went as expected
                    GUI.log('<span style="color: green">Successfully</span> closed serial connection');
                } else { // Something went wrong
                    GUI.log('<span style="color: red">Failed</span> to close serial port');
                }
            });
        }
    }, 2000, true);
};

STK500v2_protocol.prototype.read = function(readInfo) {
    var data = new Uint8Array(readInfo.data);
    
    for (var i = 0; i < data.length; i++) {
        // state machine
        switch(this.message_state) {
            case 0:
                if (data[i] == this.message.MESSAGE_START) {
                    this.message_crc ^= data[i];
                    this.message_state++;
                }
                break;
            case 1:
                if (data[i] == (this.sequence_number - 1)) { // -1 because sequence_number increments in .send
                    this.message_crc ^= data[i];
                    this.message_state++;
                } else {
                    this.message_crc = 0;
                    this.message_state = 0;
                }
                break;
            case 2:
                this.message_size = data[i] << 8; // MSB
                this.message_crc ^= data[i];
                
                this.message_state++;
                break;
            case 3:
                this.message_size |= data[i]; // LSB
                this.message_crc ^= data[i];
                
                this.message_state++;
                break;
            case 4:
                if (data[i] == this.message.TOKEN) {
                    this.message_buffer = new ArrayBuffer(this.message_size);
                    this.message_buffer_uint8_view = new Uint8Array(this.message_buffer);
                    this.message_crc ^= data[i];
                    
                    this.message_state++;
                } else {
                    this.message_crc = 0;
                    this.message_state = 0;
                }
                break;
            case 5:
                this.message_buffer_uint8_view[this.message_buffer_i] = data[i];
                this.message_crc ^= data[i];
                this.message_buffer_i++;
                
                if (this.message_buffer_i >= this.message_size) {
                    this.message_state++;
                }                
                break;
            case 6:
                if (this.message_crc == data[i]) {
                    // message received, all is proper, process
                    console.log(this.message_buffer_uint8_view);
                } else {
                    // crc failed
                    console.log('crc failed, sequence: ' + (this.sequence_number - 1));
                    console.log(this.message_buffer_uint8_view);
                    console.log(this.message_crc + ' ' + data[i]);
                }
                
                this.message_buffer_i = 0;
                this.message_crc = 0;
                this.message_state = 0;
                break;
        }
    }
};

STK500v2_protocol.prototype.send = function(Array, callback) {
    var bufferOut = new ArrayBuffer(Array.length + 6); // 6 bytes protocol overhead
    var bufferView = new Uint8Array(bufferOut);
    
    bufferView[0] = this.message.MESSAGE_START;
    bufferView[1] = this.sequence_number++;
    bufferView[2] = Array.length >> 8;      // MSB
    bufferView[3] = Array.length & 0x00FF;  // LSB
    bufferView[4] = this.message.TOKEN;
    
    bufferView.set(Array, 5); // apply protocol offset
    
    // calculate CRC
    var crc = 0;
    for (var i = 0; i < (bufferView.length - 1); i++) {
        crc ^= bufferView[i];
    }
    bufferView[bufferView.length - 1] = crc;
    
    serial.send(bufferOut, function(writeInfo) {}); 
};

STK500v2_protocol.prototype.connect = function(baud, hex) {
    var self = this;
    self.hex = hex;
    
    var selected_port = String($('div#controls #port').val());
    
    if (selected_port != '0') {
        serial.connect(selected_port, {bitrate: baud}, function(openInfo) {
            if (openInfo) {
                GUI.log('Connection <span style="color: green">successfully</span> opened with ID: ' + openInfo.connectionId);
                
                self.initialize();
            } else {
                GUI.log('<span style="color: red">Failed</span> to open serial port');
            }
        });
    } else {
        GUI.log('Please select valid serial port');
    }    
};

var STK500V2 = new STK500v2_protocol();