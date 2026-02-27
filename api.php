<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

define('DATA_DIR', __DIR__ . '/data/');
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('EARNINGS_PER_DOWNLOAD', 0.50); // Change this value as needed

if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);
if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);

function readJson($file) {
    $path = DATA_DIR . $file;
    if (!file_exists($path)) return [];
    return json_decode(file_get_contents($path), true) ?: [];
}
function writeJson($file, $data) {
    file_put_contents(DATA_DIR . $file, json_encode($data, JSON_PRETTY_PRINT));
}

define('ADMIN_PIN', '5026');
define('ADMIN_PASS', '078502');

$action = $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'getCurrentUser':
            $users = readJson('users.json');
            if (empty($users)) {
                $users[] = [
                    'id' => 1,
                    'username' => 'Admin',
                    'email' => 'admin@example.com',
                    'password' => ADMIN_PASS,
                    'accounts' => [],
                    'joinedDate' => date('Y-m-d')
                ];
                writeJson('users.json', $users);
            }
            echo json_encode(['user' => $users[0]]);
            break;

        case 'getUpdates':
            echo json_encode(['updates' => readJson('updates.json')]);
            break;

        case 'createUpdate':
            $title = $_POST['title'] ?? '';
            $desc = $_POST['description'] ?? '';
            $image = null;
            if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
                $ext = pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION);
                $filename = uniqid() . '.' . $ext;
                move_uploaded_file($_FILES['image']['tmp_name'], UPLOAD_DIR . $filename);
                $image = 'uploads/' . $filename;
            }
            $updates = readJson('updates.json');
            array_unshift($updates, [
                'id' => time(),
                'title' => $title,
                'description' => $desc,
                'image' => $image,
                'date' => date('Y-m-d H:i:s')
            ]);
            writeJson('updates.json', $updates);
            echo json_encode(['success' => true]);
            break;

        case 'deleteUpdate':
            $id = $_POST['id'] ?? 0;
            $updates = array_filter(readJson('updates.json'), fn($u) => $u['id'] != $id);
            writeJson('updates.json', array_values($updates));
            echo json_encode(['success' => true]);
            break;

        case 'getFiles':
            echo json_encode(['files' => readJson('files.json')]);
            break;

        case 'uploadFile':
            $type = $_POST['type'] ?? '';
            if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK)
                throw new Exception('File upload error');
            $ext = pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION);
            $filename = uniqid() . '.' . $ext;
            move_uploaded_file($_FILES['file']['tmp_name'], UPLOAD_DIR . $filename);
            $files = readJson('files.json');
            $files[] = [
                'id' => time(),
                'name' => $_FILES['file']['name'],
                'type' => $type,
                'date' => date('Y-m-d H:i:s'),
                'size' => round(filesize(UPLOAD_DIR . $filename) / 1024, 2) . ' KB',
                'path' => 'uploads/' . $filename,
                'downloads' => 0
            ];
            writeJson('files.json', $files);
            echo json_encode(['success' => true]);
            break;

        case 'deleteFile':
            $id = $_POST['id'] ?? 0;
            $files = readJson('files.json');
            foreach ($files as $f) {
                if ($f['id'] == $id && file_exists($f['path'])) unlink($f['path']);
            }
            $files = array_filter($files, fn($f) => $f['id'] != $id);
            writeJson('files.json', array_values($files));
            echo json_encode(['success' => true]);
            break;

        // Track download and add earnings
        case 'trackDownload':
            $id = $_POST['id'] ?? 0;
            $files = readJson('files.json');
            $updated = false;
            foreach ($files as &$f) {
                if ($f['id'] == $id) {
                    $f['downloads'] = ($f['downloads'] ?? 0) + 1;
                    $updated = true;
                    break;
                }
            }
            if ($updated) {
                writeJson('files.json', $files);
                $earnings = readJson('earnings.json');
                $balance = $earnings['balance'] ?? 0;
                $earnings['balance'] = $balance + EARNINGS_PER_DOWNLOAD;
                $earnings['total_downloads'] = ($earnings['total_downloads'] ?? 0) + 1;
                writeJson('earnings.json', $earnings);
            }
            echo json_encode(['success' => true]);
            break;

        case 'getAds':
            echo json_encode(['ads' => readJson('ads.json')]);
            break;

        case 'getAd':
            $id = $_POST['id'] ?? 0;
            $ad = current(array_filter(readJson('ads.json'), fn($a) => $a['id'] == $id)) ?: null;
            echo json_encode(['ad' => $ad]);
            break;

        case 'addAd':
            $ad = json_decode($_POST['ad'] ?? '{}', true);
            $ads = readJson('ads.json');
            $ads[] = $ad;
            writeJson('ads.json', $ads);
            echo json_encode(['success' => true]);
            break;

        case 'updateAd':
            $id = $_POST['id'] ?? 0;
            $updates = json_decode($_POST['updates'] ?? '{}', true);
            $ads = readJson('ads.json');
            foreach ($ads as &$a) {
                if ($a['id'] == $id) { $a = array_merge($a, $updates); break; }
            }
            writeJson('ads.json', $ads);
            echo json_encode(['success' => true]);
            break;

        case 'deleteAd':
            $id = $_POST['id'] ?? 0;
            $ads = array_filter(readJson('ads.json'), fn($a) => $a['id'] != $id);
            writeJson('ads.json', array_values($ads));
            echo json_encode(['success' => true]);
            break;

        case 'verifyAdmin':
            $pin = $_POST['pin'] ?? '';
            $pass = $_POST['pass'] ?? '';
            echo json_encode(['success' => ($pin === ADMIN_PIN && $pass === ADMIN_PASS)]);
            break;

        case 'getStats':
            echo json_encode([
                'users' => count(readJson('users.json')),
                'updates' => count(readJson('updates.json')),
                'files' => count(readJson('files.json'))
            ]);
            break;

        case 'getUsers':
            $users = readJson('users.json');
            foreach ($users as &$u) unset($u['password']);
            echo json_encode(['users' => $users]);
            break;

        case 'updateUser':
            $id = $_POST['id'] ?? 0;
            $users = readJson('users.json');
            foreach ($users as &$u) {
                if ($u['id'] == $id) {
                    if (isset($_POST['username'])) $u['username'] = $_POST['username'];
                    if (isset($_POST['password'])) $u['password'] = $_POST['password'];
                    break;
                }
            }
            writeJson('users.json', $users);
            echo json_encode(['success' => true]);
            break;

        case 'updateUserAccounts':
            $id = $_POST['userId'] ?? 0;
            $accounts = json_decode($_POST['accounts'] ?? '[]', true);
            $users = readJson('users.json');
            foreach ($users as &$u) {
                if ($u['id'] == $id) { $u['accounts'] = $accounts; break; }
            }
            writeJson('users.json', $users);
            echo json_encode(['success' => true]);
            break;

        // Earnings and withdrawals
        case 'getEarnings':
            $earnings = readJson('earnings.json');
            $withdrawals = readJson('withdrawals.json');
            echo json_encode([
                'balance' => $earnings['balance'] ?? 0,
                'total_downloads' => $earnings['total_downloads'] ?? 0,
                'withdrawals' => array_slice(array_reverse($withdrawals), 0, 10)
            ]);
            break;

        case 'withdraw':
            $amount = floatval($_POST['amount'] ?? 0);
            $method = $_POST['method'] ?? 'paypal';
            $account = $_POST['account'] ?? '';
            $earnings = readJson('earnings.json');
            $balance = $earnings['balance'] ?? 0;
            if ($amount > $balance) {
                echo json_encode(['success' => false, 'error' => 'Insufficient balance']);
                break;
            }
            if ($amount < 20) {
                echo json_encode(['success' => false, 'error' => 'Minimum withdrawal is $20']);
                break;
            }
            $withdrawals = readJson('withdrawals.json');
            $withdrawals[] = [
                'id' => time(),
                'date' => date('Y-m-d H:i:s'),
                'amount' => $amount,
                'method' => $method,
                'account' => $account,
                'status' => 'pending'
            ];
            writeJson('withdrawals.json', $withdrawals);
            $earnings['balance'] = $balance - $amount;
            writeJson('earnings.json', $earnings);
            echo json_encode(['success' => true]);
            break;

        default:
            echo json_encode(['error' => 'Invalid action']);
    }
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}