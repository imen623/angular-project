// src/app/dashboard/dashboard.component.ts
import { Component, OnInit, ChangeDetectorRef } from '@angular/core'; // Import ChangeDetectorRef
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ApiService } from '../../services/api.service';
import { finalize, timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatDialogModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  loading = true;
  error: string | null = null;
  isModalOpen = false;
  selectedItem: any;
  showAddDeviceModal = false;
  devices: any[] = [];
  idError = false;
  idErrorMessage: string | null = null; // Specific error message for ID
  savingDevice = false;

  deviceTelemetry: Map<string, number | string> = new Map();
  telemetryLoading: Map<string, boolean> = new Map();
  telemetryError: Map<string, string | null> = new Map();

  newDevice = {
    name: '',
    id: '',
    type: 'sensor',
  };

  constructor(
    private apiService: ApiService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {} // Inject ChangeDetectorRef

  ngOnInit(): void {
    this.fetchDevices();
  }

  fetchDevices(): void {
    this.loading = true;
    this.apiService
      .getDevices()
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (devices) => {
          this.devices = Array.isArray(devices) ? devices : [];
          this.error = null;

          this.devices.forEach((device) => {
            if (device.thingsboard_device_id) {
              this.fetchTelemetryForDevice(device.thingsboard_device_id);
            }
          });
          this.cdr.detectChanges(); // Force update after all initial devices are processed
        },
        error: (err) => {
          console.error('Error fetching devices:', err);
          this.error = err.message || 'Failed to load devices.';
          this.devices = [];
          this.cdr.detectChanges(); // Force update on error
        },
      });
  }

  fetchTelemetryForDevice(deviceId: string): void {
    this.telemetryLoading.set(deviceId, true);
    this.telemetryError.set(deviceId, null);

    console.log(`[Telemetry] Fetching for device ID: ${deviceId}`);

    this.apiService
      .getData(deviceId)
      .pipe(
        timeout(10000),
        catchError((err) => {
          console.error(
            `[Telemetry] Request for ${deviceId} failed or timed out:`,
            err
          );
          this.telemetryError.set(
            deviceId,
            'Failed to load telemetry or timed out.'
          );
          this.deviceTelemetry.set(deviceId, 'Error');
          this.cdr.detectChanges(); // Force update on error/timeout
          return of(null);
        }),
        finalize(() => {
          this.telemetryLoading.set(deviceId, false);
          console.log(
            `[Telemetry] Finished for device ID: ${deviceId}. Loading state: ${this.telemetryLoading.get(
              deviceId
            )}`
          );
          this.cdr.detectChanges(); // Force update after loading state changes
        })
      )
      .subscribe({
        next: (response) => {
          console.log(`[Telemetry] Response for ${deviceId}:`, response);

          if (
            response &&
            response.temperature &&
            response.temperature.length > 0
          ) {
            const latestTemperature = response.temperature[0].value;
            console.log(
              `[Telemetry] Extracted temperature for ${deviceId}: ${latestTemperature}`
            );
            this.deviceTelemetry.set(deviceId, Number(latestTemperature));
            this.telemetryError.set(deviceId, null); // Clear error if data is found
          } else if (response === null) {
            console.log(
              `[Telemetry] Response for ${deviceId} was null (likely caught error).`
            );
          } else {
            console.warn(
              `[Telemetry] No temperature data found for ${deviceId}. Response:`,
              response
            );
            this.deviceTelemetry.set(deviceId, 'N/A');
            this.telemetryError.set(deviceId, 'No telemetry data available.');
          }
          this.cdr.detectChanges(); // Force update after data is processed
        },
        error: (err) => {
          // This block should ideally not be hit if catchError in pipe works correctly
          console.error(
            `[Telemetry] Unhandled error in subscription for ${deviceId}:`,
            err
          );
          this.telemetryError.set(deviceId, 'An unexpected error occurred.');
          this.deviceTelemetry.set(deviceId, 'Error');
          this.cdr.detectChanges(); // Force update on unhandled error
        },
      });
  }

  openAddDeviceModal(): void {
    this.showAddDeviceModal = true;
    this.idError = false;
    this.idErrorMessage = null;
    this.newDevice = { name: '', id: '', type: 'sensor' };
  }

  closeAddDeviceModal(): void {
    this.showAddDeviceModal = false;
    this.idError = false;
    this.idErrorMessage = null;
    this.savingDevice = false;
  }

  saveNewDevice(): void {
    this.idError = false;
    this.idErrorMessage = null;
    this.savingDevice = true;

    this.apiService
      .validateThingsBoardDeviceId(this.newDevice.id)
      .pipe(finalize(() => (this.savingDevice = false)))
      .subscribe({
        next: (isValid) => {
          if (isValid) {
            const deviceToSave = {
              name: this.newDevice.name,
              type: this.newDevice.type,
              thingsboard_device_id: this.newDevice.id,
            };

            this.apiService.saveDevice(deviceToSave).subscribe({
              next: (savedDevice) => {
                console.log('Device saved to Laravel:', savedDevice);
                this.devices.push(savedDevice);
                this.closeAddDeviceModal();
                this.error = null;

                if (savedDevice.thingsboard_device_id) {
                  this.fetchTelemetryForDevice(
                    savedDevice.thingsboard_device_id
                  );
                }
                this.cdr.detectChanges(); // Force update after new device is added and telemetry fetch initiated
              },
              error: (saveErr) => {
                console.error('Error saving device to Laravel:', saveErr);
                this.error = saveErr.message || 'Failed to save device.';

                if (
                  saveErr.status === 409 &&
                  saveErr.error &&
                  saveErr.error.errors &&
                  saveErr.error.errors.thingsboard_device_id
                ) {
                  const errorMessage =
                    saveErr.error.errors.thingsboard_device_id[0];
                  const match = errorMessage.match(
                    /This ID is already taken by device '(.+?)'\./
                  );
                  if (match && match[1]) {
                    this.idError = true;
                    this.idErrorMessage = `This ID is taken by device: ${match[1]}`;
                  } else {
                    this.idError = true;
                    this.idErrorMessage = errorMessage;
                  }
                } else {
                  this.idError = true;
                  this.idErrorMessage =
                    saveErr.message || 'Failed to save device.';
                }
                this.cdr.detectChanges(); // Force update on save error
              },
            });
          } else {
            this.idError = true;
            this.idErrorMessage = 'ThingsBoard ID validation failed.';
            this.cdr.detectChanges(); // Force update on validation error
          }
        },
        error: (validationErr) => {
          this.idError = true;
          this.idErrorMessage =
            validationErr.message ||
            `Cannot find device with ID: ${this.newDevice.id}`;
          console.error('ThingsBoard ID validation error:', validationErr);
          this.cdr.detectChanges(); // Force update on validation error
        },
      });
  }

  openModal(item: any): void {
    this.selectedItem = item;
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
  }
}
