import { memo, useEffect, useRef } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

const CHART_THEME = {
  background: "#0a0a0a",
  panel: "#111111",
  border: "#1f1f1f",
  text: "#e5e5e5",
  secondary: "#8a8a8a",
  bull: "#22c55e",
  bear: "#ef4444",
};

function toCandleData(candles) {
  return (Array.isArray(candles) ? candles : []).map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function toMarkers(signals) {
  return (Array.isArray(signals) ? signals : []).map((signal) => ({
    time: signal.time,
    position: signal.position,
    shape: signal.shape,
    color: signal.color,
    text: signal.side,
  }));
}

function toLineStyle(value) {
  return value === "dashed" ? LineStyle.Dashed : LineStyle.Solid;
}

function ForexChart({ candles, signals, overlays, viewport }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const overlaySeriesRef = useRef(new Map());
  const resizeObserverRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) {
      return undefined;
    }

    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: container.clientHeight || 420,
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.text,
      },
      grid: {
        vertLines: { color: CHART_THEME.border },
        horzLines: { color: CHART_THEME.border },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.border,
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_THEME.bull,
      downColor: CHART_THEME.bear,
      wickUpColor: CHART_THEME.bull,
      wickDownColor: CHART_THEME.bear,
      borderUpColor: CHART_THEME.bull,
      borderDownColor: CHART_THEME.bear,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });

    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      overlaySeriesRef.current.clear();
      chart.remove();
      resizeObserverRef.current = null;
      candleSeriesRef.current = null;
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current) {
      return;
    }

    candleSeriesRef.current.setData(toCandleData(candles));
    candleSeriesRef.current.setMarkers(toMarkers(signals));
    if (!viewport && Array.isArray(candles) && candles.length) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles, signals, viewport]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const seriesMap = overlaySeriesRef.current;
    const nextIds = new Set((Array.isArray(overlays) ? overlays : []).map((overlay) => overlay.id));

    for (const [overlayId, series] of seriesMap.entries()) {
      if (!nextIds.has(overlayId)) {
        chart.removeSeries(series);
        seriesMap.delete(overlayId);
      }
    }

    for (const overlay of Array.isArray(overlays) ? overlays : []) {
      let series = seriesMap.get(overlay.id);
      if (!series) {
        series = chart.addLineSeries({
          color: overlay.color || CHART_THEME.secondary,
          lineWidth: overlay.lineWidth ?? 2,
          lineStyle: toLineStyle(overlay.lineStyle),
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        seriesMap.set(overlay.id, series);
      } else {
        series.applyOptions({
          color: overlay.color || CHART_THEME.secondary,
          lineWidth: overlay.lineWidth ?? 2,
          lineStyle: toLineStyle(overlay.lineStyle),
        });
      }

      series.setData(Array.isArray(overlay.data) ? overlay.data : []);
    }
  }, [overlays]);

  useEffect(() => {
    if (!chartRef.current || !Array.isArray(candles) || candles.length === 0) {
      return;
    }

    if (viewport?.from && viewport?.to) {
      chartRef.current.timeScale().setVisibleRange({
        from: viewport.from,
        to: viewport.to,
      });
      return;
    }

    chartRef.current.timeScale().fitContent();
  }, [candles, viewport]);

  return <div ref={containerRef} className="h-full w-full min-h-[340px]" />;
}

export default memo(ForexChart);
