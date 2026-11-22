# R260 项10：TripoSR 单图→mesh 推理子进程脚本（MIT，Stability AI + Tripo，arXiv:2403.02151）。
# 零原生约定：Python/torch 只活在独立子进程，主进程经 IPC 收 glb 路径。
# 用法: python triposr-run.py <input_image> <output_glb> <model_dir> [device] [resolution]
# 约定: 成功打印一行 JSON {"ok":true,"glb":...}；失败打印 {"ok":false,"error":...}（绝不伪造成功）。
import sys, os, json, traceback


def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)[:500]}))
    sys.exit(0)


def main():
    if len(sys.argv) < 4:
        fail("usage: triposr-run.py <input_image> <output_glb> <model_dir> [device] [resolution]")
    img_path, out_glb, model_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    # R294：tsr 是源码包（local-gen/TripoSR），按路径导入；DINO 骨干下载走 HF 镜像（国内可达）
    sys.path.insert(0, os.path.join(model_dir, "TripoSR"))
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    device = sys.argv[4] if len(sys.argv) > 4 else ("cuda" if _has_cuda() else "cpu")
    resolution = int(sys.argv[5]) if len(sys.argv) > 5 else 256
    if not os.path.isfile(img_path):
        fail("input-image-not-found")
    try:
        import numpy as np
        import torch
        from PIL import Image
        from tsr.system import TSR
        from tsr.utils import remove_background, resize_foreground
    except Exception as e:  # 环境缺失如实上报
        fail("env-missing: " + str(e))
    try:
        weight = "model.bin" if os.path.isfile(os.path.join(model_dir, "model.bin")) else "model.ckpt"
        model = TSR.from_pretrained(model_dir, config_name="config.yaml", weight_name=weight)
        model.renderer.set_chunk_size(8192)
        model.to(device)
        image = Image.open(img_path).convert("RGBA")
        # R294：rembg 首次需下 u2net（GitHub 可能不可达）⇒ 有限等待＋失败优雅降级（用原 alpha 合白底），警告如实输出。
        # 用 daemon 线程＋队列：超时真能弃（ThreadPoolExecutor 的 with 会等线程结束，下载挂死会拖住进程）。
        try:
            import threading, queue
            _q = queue.Queue()
            def _rembg_work():
                try:
                    _q.put(("ok", remove_background(image)))
                except Exception as _e:
                    _q.put(("err", _e))
            _t = threading.Thread(target=_rembg_work, daemon=True)
            _t.start()
            _kind, _val = _q.get(timeout=90)
            if _kind == "ok":
                image = _val
            else:
                raise _val
        except Exception as e:
            print(json.dumps({"warning": "rembg-degraded: " + str(e)[:120]}), file=sys.stderr)
        image = resize_foreground(image, 0.85)
        # R294：resize_foreground 输出尺寸随前景变（实测 601×601），模型 cond_image_size=512 ⇒ 显式归一（官方 gradio 同做法）
        image = image.resize((512, 512))
        # R294：新版 tsr API 直收 PIL/np（image_processor 内部归一化）；手搭 (1,3,H,W) 张量会被当 HWC 错排维度。
        # RGBA 须先合白底转 RGB（image_processor 不去 alpha，4 通道会与 mean 3 冲突）
        arr = np.array(image).astype(np.float32) / 255.0
        arr = arr[:, :, :3] * arr[:, :, 3:4] + (1.0 - arr[:, :, 3:4])
        image = Image.fromarray((arr * 255.0).astype(np.uint8), "RGB")
        with torch.no_grad():
            codes = model(image, device=device)
        mesh = model.extract_mesh(codes, has_vertex_color=True, resolution=resolution)[0]
        os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
        mesh.export(out_glb)
        print(json.dumps({"ok": True, "glb": os.path.abspath(out_glb)}))
    except Exception as e:
        fail("inference-failed: " + str(e) + " | " + traceback.format_exc(limit=2).replace("\n", " ")[:300])


def _has_cuda():
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


if __name__ == "__main__":
    main()