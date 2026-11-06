export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      sensor_readings: {
        Row: {
          id: number;
          device_id: string;
          moisture_pct: number;
          raw_value: number;
          rssi: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          device_id: string;
          moisture_pct: number;
          raw_value: number;
          rssi?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          device_id?: string;
          moisture_pct?: number;
          raw_value?: number;
          rssi?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      device_state: {
        Row: {
          device_id: string;
          last_alert_type: "DRY" | "NORMAL" | "FAULT";
          last_alert_at: string | null;
          updated_at: string;
        };
        Insert: {
          device_id: string;
          last_alert_type?: "DRY" | "NORMAL" | "FAULT";
          last_alert_at?: string | null;
          updated_at?: string;
        };
        Update: {
          device_id?: string;
          last_alert_type?: "DRY" | "NORMAL" | "FAULT";
          last_alert_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
