#!/bin/bash
set -e

echo "Starting deployment for Tender Portal..."

# 1. Get git commit hash for tagging
COMMIT_HASH=$(git rev-parse --short HEAD)
if [ -z "$COMMIT_HASH" ]; then
  echo "Error: Could not determine git commit hash."
  exit 1
fi

BACKEND_IMAGE="tender-backend:$COMMIT_HASH"
FRONTEND_IMAGE="tender-frontend:$COMMIT_HASH"
REGISTRY="your-registry.example.com" # Replace with actual registry

echo "Building images with tag: $COMMIT_HASH"

# 2. Build Docker images
docker build -t "$REGISTRY/$BACKEND_IMAGE" ./backend
docker build -t "$REGISTRY/$FRONTEND_IMAGE" ./frontend

# 3. Push to registry
echo "Pushing images to registry..."
docker push "$REGISTRY/$BACKEND_IMAGE"
docker push "$REGISTRY/$FRONTEND_IMAGE"

# 4. Update k8s manifests with new image tags inline (or use kustomize, here we use sed for simplicity if needed, but since we are using kubectl set image, it's safer)
echo "Applying base Kubernetes configurations..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/services/
kubectl apply -f k8s/deployments/postgres.yaml
kubectl apply -f k8s/deployments/backend.yaml
kubectl apply -f k8s/deployments/frontend.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/monitoring/

echo "Updating deployment images to $COMMIT_HASH..."
kubectl set image deployment/backend backend="$REGISTRY/$BACKEND_IMAGE" -n tender-portal
kubectl set image deployment/frontend frontend="$REGISTRY/$FRONTEND_IMAGE" -n tender-portal

# 5. Wait for rollout
echo "Waiting for backend rollout..."
if ! kubectl rollout status deployment/backend -n tender-portal --timeout=180s; then
  echo "Backend rollout failed! Initiating rollback..."
  kubectl rollout undo deployment/backend -n tender-portal
  exit 1
fi

echo "Waiting for frontend rollout..."
if ! kubectl rollout status deployment/frontend -n tender-portal --timeout=180s; then
  echo "Frontend rollout failed! Initiating rollback..."
  kubectl rollout undo deployment/frontend -n tender-portal
  exit 1
fi

# 6. Smoke Tests
echo "Running smoke tests..."
sleep 5
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://tender.maharashtra.gov.in/api/health)
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "Smoke test failed! Expected HTTP 200, got $HEALTH_STATUS. Initiating rollback..."
  kubectl rollout undo deployment/backend -n tender-portal
  kubectl rollout undo deployment/frontend -n tender-portal
  exit 1
fi

echo "Deployment completed successfully! (Tag: $COMMIT_HASH)"
