"use client";
import { useCallback, useEffect, useState } from "react";
import type { Interview, InterviewResponse, ProctorEvent } from "../types";
import { api } from "./api";

export interface InterviewData {
  interview: Interview;
  responses: InterviewResponse[];
  proctorEvents: ProctorEvent[];
}

/** Loads an interview and keeps polling while `poll(data)` returns true. */
export function useInterview(id: string, poll: (d: InterviewData | null) => boolean = () => false) {
  const [data, setData] = useState<InterviewData | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await api<InterviewData>(`/api/interviews/${id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const shouldPoll = poll(data);
  useEffect(() => {
    if (!shouldPoll) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [shouldPoll, reload]);

  return { data, error, reload, setData };
}
