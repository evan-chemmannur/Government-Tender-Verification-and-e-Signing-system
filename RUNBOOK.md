# Government Tender Portal - Runbook

This guide covers the deployment, scaling, debugging, and backup procedures for the Government Tender Portal on Kubernetes.

## Setup Instructions for First Deployment

1. **Namespace & Base Config**
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/configmap.yaml
   ```

2. **Create Secrets**
   Before deploying, create the required secrets using the following command (replace placeholder values with real ones):
   ```bash
   kubectl create secret generic tender-portal-secrets \
     --namespace=tender-portal \
     --from-literal=DB_PASSWORD="your-db-password" \
     --from-literal=SESSION_SECRET="your-session-secret" \
     --from-literal=OIDC_PRIVATE_KEY="your-oidc-private-key" \
     --from-literal=INJI_CLIENT_SECRET="your-certify-secret"
     
   kubectl create secret generic postgres-secrets \
     --namespace=tender-portal \
     --from-literal=POSTGRES_USER="tender_admin" \
     --from-literal=POSTGRES_PASSWORD="your-db-password" \
     --from-literal=POSTGRES_DB="tender_db"
   ```

3. **Deploy the Rest of the Stack**
   ```bash
   # Make sure deploy script is executable
   chmod +x scripts/deploy.sh
   # Run the deployment script
   ./scripts/deploy.sh
   ```

---

## Operations

### How to Roll Back
If a deployment fails or causes a regression, you can quickly revert to the previous ReplicaSet image:
```bash
# Rollback backend
kubectl rollout undo deployment/backend -n tender-portal

# Rollback frontend
kubectl rollout undo deployment/frontend -n tender-portal
```

### How to Scale Manually
While the HPA automatically handles scaling for the backend (`k8s/hpa.yaml`), you can manually scale components if necessary (e.g. for frontend or overriding backend):
```bash
# Scale frontend to 4 replicas
kubectl scale deployment frontend --replicas=4 -n tender-portal

# Scale backend manually (NOTE: HPA will override this unless you delete or suspend the HPA first)
kubectl scale deployment backend --replicas=5 -n tender-portal
```

### How to View Logs
To troubleshoot application errors, view the logs of the running pods:
```bash
# Stream logs for all backend pods
kubectl logs -f -l app=backend -n tender-portal

# Stream logs for the database
kubectl logs -f -l app=postgres -n tender-portal
```

### How to Debug a Live Pod
If you need to enter the shell of a running container for deep troubleshooting:
```bash
# 1. Get the exact pod name
kubectl get pods -n tender-portal

# 2. Exec into the pod
kubectl exec -it <pod-name> -n tender-portal -- bash
```

---

## PostgreSQL Backup Strategy

PostgreSQL runs as a `StatefulSet` with a `PersistentVolumeClaim`. Because the Tender Portal handles critical government data, a robust backup strategy is required.

**Recommended Strategy: Automated Logical Backups + Volume Snapshots**

1. **Daily Logical Backups (CronJob)**
   Deploy a Kubernetes `CronJob` that runs `pg_dump` daily and uploads the compressed dump directly to an S3-compatible object storage bucket (e.g. AWS S3, MinIO on government cloud).
   ```bash
   # Example pg_dump command run inside the CronJob container
   pg_dump -h postgres-service -U tender_admin tender_db | gzip > dump_$(date +%Y%m%d).sql.gz
   aws s3 cp dump_*.sql.gz s3://tender-portal-backups/
   ```

2. **CSI Volume Snapshots (Point-in-Time Recovery)**
   Ensure the storage class providing the `20Gi` PVC supports Kubernetes `VolumeSnapshot` resources. Schedule automated VolumeSnapshots every 4-6 hours to allow for instantaneous point-in-time storage recovery at the block level without manually restoring SQL dumps.

3. **High Availability (Future Architecture)**
   If running on a bare-metal government cloud without managed DB services, consider replacing the single `StatefulSet` with a managed operator like **Zalando Postgres Operator** or **CrunchyData PGO** to automatically handle replication, high availability, WAL archiving, and failovers natively in Kubernetes.
