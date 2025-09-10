import React, { useRef, useEffect, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { X, Camera, CameraOff } from 'lucide-react';

const BarcodeScanner = ({ 
  isOpen, 
  onClose, 
  onScan, 
  title = "Scan Barcode" 
}) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(null);

  // Initialize the barcode reader
  useEffect(() => {
    if (isOpen) {
      readerRef.current = new BrowserMultiFormatReader();
    }
    return () => {
      if (readerRef.current) {
        readerRef.current.reset();
        readerRef.current = null;
      }
    };
  }, [isOpen]);

  // Handle barcode detection
  const handleScan = useCallback((result, error) => {
    if (result) {
      const code = result.getText();
      if (code && code.trim()) {
        onScan(code.trim());
        stopScanning();
      }
    }
    
    if (error && !(error instanceof NotFoundException)) {
      console.warn('Barcode scan error:', error);
    }
  }, [onScan]);

  // Start camera and scanning
  const startScanning = useCallback(async () => {
    if (!readerRef.current || !videoRef.current) return;

    try {
      setError(null);
      setIsScanning(true);

      // Get user media directly using Web API
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' }, // Prefer back camera
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      
      // Start the video
      await videoRef.current.play();

      // Start barcode detection using ZXing
      const result = await readerRef.current.decodeFromVideoElement(videoRef.current);
      if (result) {
        handleScan(result, null);
      }

      // Continuous scanning
      const scanContinuously = () => {
        if (!videoRef.current || !readerRef.current) return;

        readerRef.current.decodeFromVideoElement(videoRef.current)
          .then(result => {
            if (result) {
              handleScan(result, null);
            } else {
              // Continue scanning if no result
              if (isScanning) {
                setTimeout(scanContinuously, 100);
              }
            }
          })
          .catch(error => {
            if (!(error instanceof NotFoundException) && isScanning) {
              console.warn('Scan error:', error);
              setTimeout(scanContinuously, 100);
            }
          });
      };

      // Start continuous scanning
      scanContinuously();
      
      setHasPermission(true);
    } catch (err) {
      console.error('Failed to start barcode scanner:', err);
      setError(err.message || 'Failed to access camera');
      setHasPermission(false);
      setIsScanning(false);
    }
  }, [handleScan, isScanning]);

  // Stop scanning and camera
  const stopScanning = useCallback(() => {
    setIsScanning(false);
    
    if (readerRef.current) {
      readerRef.current.reset();
    }

    // Stop video stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Start scanning when modal opens
  useEffect(() => {
    if (isOpen && !isScanning) {
      const timer = setTimeout(startScanning, 100);
      return () => clearTimeout(timer);
    } else if (!isOpen && isScanning) {
      stopScanning();
    }
  }, [isOpen, isScanning, startScanning, stopScanning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, [stopScanning]);

  // Handle close
  const handleClose = useCallback(() => {
    stopScanning();
    onClose();
  }, [stopScanning, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 !mt-0">
      <div className="bg-white rounded-lg max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scanner Content */}
        <div className="p-4">
          {/* Video Preview */}
          <div className="relative bg-gray-900 rounded-lg overflow-hidden mb-4">
            <video
              ref={videoRef}
              className="w-full h-64 object-cover"
              autoPlay
              muted
              playsInline
            />
            
            {/* Scanning Overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="border-2 border-white border-dashed w-48 h-32 rounded-lg flex items-center justify-center">
                <div className="text-white text-sm text-center">
                  {isScanning ? (
                    <div>
                      <div className="animate-pulse mb-2">📱</div>
                      <div>Position barcode here</div>
                    </div>
                  ) : (
                    <div>
                      <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <div>Starting camera...</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Status */}
          {error && (
            <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-lg mb-4">
              <CameraOff className="h-5 w-5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isScanning && (
            <div className="text-center text-sm text-gray-600 mb-4">
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Scanning for barcodes...</span>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="text-sm text-gray-600 space-y-1">
            <p>• Hold your device steady</p>
            <p>• Ensure barcode is well-lit</p>
            <p>• Align barcode within the frame</p>
            <p>• Scanner will detect automatically</p>
          </div>

          {/* Manual Entry Option */}
          <div className="mt-4 pt-4 border-t">
            <button
              onClick={() => {
                const code = prompt('Enter barcode manually:');
                if (code && code.trim()) {
                  onScan(code.trim());
                  handleClose();
                }
              }}
              className="w-full py-2 px-4 text-sm text-blue-600 hover:text-blue-800 transition-colors"
            >
              Enter barcode manually
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-2 p-4 bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          {error && (
            <button
              onClick={startScanning}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
