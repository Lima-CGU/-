"""
用傳統電腦視覺方法（非深度學習模型，因目前環境無法連網下載預訓練權重）
自動偵測圖片中「盤子/碗」區域的 bounding box。

原理：
這張圖的四道菜剛好都裝在「圓形」盤子/碗裡，比起用顏色分割背景（容易被
盤子間的陰影連在一起），改用 Hough Circle Transform 直接偵測圓形邊緣，
更穩定準確：
1. 灰階化 + 中值模糊，去除木紋與食物紋理的高頻雜訊，只留下圓形邊緣線索。
2. 用 cv2.HoughCircles 偵測所有符合半徑範圍的圓（會抓到 4 個盤子/碗）。
3. 把每個圓形 (cx, cy, r) 轉換成外接正方形的 bounding box (x_min,y_min,x_max,y_max)。
4. 依照畫面位置（先上排左到右，再下排左到右）排序並標上對應菜名。
"""

import cv2
import numpy as np
import json

img = cv2.imread("input.png")
h, w = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
gray_blur = cv2.medianBlur(gray, 9)

circles = cv2.HoughCircles(
    gray_blur, cv2.HOUGH_GRADIENT, dp=1.2, minDist=300,
    param1=80, param2=60, minRadius=200, maxRadius=280
)

if circles is None:
    raise RuntimeError("沒有偵測到圓形盤子，請調整 HoughCircles 參數")

circles = np.round(circles[0]).astype(int)  # [[cx, cy, r], ...]

def sort_key(c):
    cx, cy, r = c
    row = 0 if cy < h / 2 else 1
    return (row, cx)

circles_sorted = sorted(circles, key=sort_key)

labels = ["排骨塊 (左上)", "玉米豌豆彩椒 (右上)", "炒青花菜 (左下)", "白飯 (右下)"]
colors = [(255, 0, 0), (0, 200, 0), (0, 0, 255), (0, 200, 200)]

results = []
vis = img.copy()

for i, (cx, cy, r) in enumerate(circles_sorted):
    label = labels[i] if i < len(labels) else f"item_{i+1}"
    x_min, y_min = max(cx - r, 0), max(cy - r, 0)
    x_max, y_max = min(cx + r, w), min(cy + r, h)
    bbox = [int(x_min), int(y_min), int(x_max), int(y_max)]
    results.append({
        "label": label,
        "bbox_xyxy": bbox,
        "center": [int(cx), int(cy)],
        "radius": int(r),
    })
    cv2.circle(vis, (cx, cy), r, colors[i % len(colors)], 4)
    cv2.rectangle(vis, (x_min, y_min), (x_max, y_max), colors[i % len(colors)], 2)
    cv2.putText(vis, label, (x_min, max(y_min - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX,
                0.8, colors[i % len(colors)], 2, cv2.LINE_AA)

cv2.imwrite("bbox_visualization.png", vis)

with open("bbox_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(json.dumps(results, ensure_ascii=False, indent=2))
