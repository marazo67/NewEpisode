#!/bin/bash
set -e

echo "[+] Updating and installing packages..."
apt update
apt install -y openssh-server nano net-tools curl wget xfce4 xfce4-goodies tightvncserver dbus-x11

echo "[+] Configuring SSH..."
mkdir -p /run/sshd
echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config
echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Set root password
ROOT_PASS="kali$(shuf -i 1000-9999 -n 1)"
echo "root:$ROOT_PASS" | chpasswd

echo "[+] Starting SSH daemon..."
pkill sshd 2>/dev/null || true
/usr/sbin/sshd -D &

echo "[+] Setting up VNC..."
mkdir -p ~/.vnc

# Set VNC password 
VNC_PASS="vnc$(shuf -i 1000-9999 -n 1)"
echo "$VNC_PASS" | vncpasswd -f > ~/.vnc/passwd
chmod 600 ~/.vnc/passwd

# VNC xstartup for XFCE
cat > ~/.vnc/xstartup << 'EOF'
#!/bin/bash
xrdb $HOME/.Xresources
startxfce4 &
EOF

chmod +x ~/.vnc/xstartup

echo "[+] Starting VNC on :1..."
vncserver :1 -geometry 1280x720 -
