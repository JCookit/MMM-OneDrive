# Enhanced Pi5 System Monitor with Detailed Memory Analysis + Process Uptime (FIXED COLUMNS)
watch -n 1 '
echo "=== Raspberry Pi5 System Monitor (Detailed Memory) ==="
echo "Date: $(date)"
echo ""

echo "=== CPU & Thermal ==="
vcgencmd measure_temp | sed "s/temp=/CPU Temp: /"
vcgencmd get_throttled | sed "s/throttled=/Throttle: /"
echo "CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk "{print \$2}" | cut -d"%" -f1)%"
echo "Load Average: $(uptime | cut -d":" -f4-)"

echo ""
echo "=== Detailed Memory Breakdown ==="
free -h | awk "
NR==1{printf \"%-12s %8s %8s %8s %8s %10s %8s\n\", \"\", \$1, \$2, \$3, \$4, \$5, \$6}
NR==2{printf \"%-12s %8s %8s %8s %8s %10s %8s\n\", \"Memory:\", \$2, \$3, \$4, \$5, \$6, \$7}
NR==3{printf \"%-12s %8s %8s %8s\n\", \"Swap:\", \$2, \$3, \"n/a\"}
"

echo ""
echo "Memory Summary:"
free | awk "NR==2{printf \"  Total: %d MB | Used: %d MB (%.1f%%) | Available: %d MB (%.1f%%)\n\", \$2/1024, \$3/1024, \$3/\$2*100, \$7/1024, \$7/\$2*100}"
free | awk "NR==2{printf \"  Buffers/Cache: %d MB | Shared: %d MB | Free: %d MB\n\", \$6/1024, \$5/1024, \$4/1024}"

echo ""
echo "=== GPU & System Clocks ==="
vcgencmd measure_volts core | sed "s/volt=/Core Voltage: /"
vcgencmd measure_clock arm | awk -F= "{printf \"ARM Clock: %.0f MHz\n\", \$2/1000000}"
vcgencmd measure_clock core | awk -F= "{printf \"GPU Clock: %.0f MHz\n\", \$2/1000000}"
vcgencmd measure_clock v3d | awk -F= "{printf \"3D Clock: %.0f MHz\n\", \$2/1000000}"


echo ""
echo "=== Node.js/Electron Processes (Top 8 by CPU) ==="
echo "USER     PID    CPU%   MEM%  RSS(MB)  VSZ(MB)    UPTIME       COMMAND"
echo "-------- ------ ------ ----- -------- ---------- ------------ ------------------------------------------"
ps -eo user,pid,pcpu,pmem,rss,vsz,etime,args | grep -E "(node|electron)" | grep -v grep | sort -k3 -nr | head -8 | awk "{
  cmd = \$8 \" \" \$9 \" \" \$10 \" \" \$11 \" \" \$12 \" \" \$13;
  if (length(cmd) > 42) cmd = substr(cmd, 1, 39) \"...\";
  printf \"%-8s %-6s %6s %5s %8.1f %10.1f %-12s %-42s\n\", \$1, \$2, \$3\"%\", \$4\"%\", \$5/1024, \$6/1024, \$7, cmd
}"

echo ""
echo "=== Process Memory Details ==="
WORKER_PID=$(pgrep -f "vision-worker.js" | head -1)
MM_PID=$(pgrep -f "electron.*MagicMirror" | head -1)

if [ ! -z "$WORKER_PID" ]; then
    echo "Vision Worker ($WORKER_PID):"
    if [ -f "/proc/$WORKER_PID/status" ]; then
        grep -E "(VmSize|VmRSS|VmHWM|VmData|VmStk|VmExe|VmLib|VmSwap)" /proc/$WORKER_PID/status | awk "{printf \"  %-8s %6s %s\n\", \$1, \$2, \$3}"
    fi
else
    echo "Vision Worker: NOT RUNNING"
fi

if [ ! -z "$MM_PID" ]; then
    echo "MagicMirror ($MM_PID):"
    if [ -f "/proc/$MM_PID/status" ]; then
        grep -E "(VmSize|VmRSS|VmHWM|VmData)" /proc/$MM_PID/status | awk "{printf \"  %-8s %6s %s\n\", \$1, \$2, \$3}" | head -4
    fi
else
    echo "MagicMirror: NOT RUNNING"
fi

echo ""
echo "=== System I/O & Network ==="
iostat -d 1 1 | tail -n +4 | head -5 | awk "NR>1{printf \"Disk %-8s: %5.1f r/s %5.1f w/s\n\", \$1, \$4, \$5}"
echo "Network: $(cat /proc/net/dev | grep -E "(wlan0|eth0)" | head -1 | awk "{printf \"RX: %.1f MB TX: %.1f MB\", \$2/1024/1024, \$10/1024/1024}")"
'
