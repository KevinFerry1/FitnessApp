from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tracker", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="AppSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("display_name", models.CharField(default="Your profile", max_length=80)),
                ("calorie_goal", models.PositiveIntegerField(default=2800)),
                ("protein_goal", models.PositiveIntegerField(default=180)),
                ("preferred_weight_unit", models.CharField(choices=[("lb", "lb"), ("kg", "kg")], default="lb", max_length=2)),
            ],
        ),
        migrations.AddField(
            model_name="foodlog", name="client_id", field=models.UUIDField(blank=True, null=True, unique=True)
        ),
        migrations.AddField(
            model_name="bodyweightentry", name="client_id", field=models.UUIDField(blank=True, null=True, unique=True)
        ),
        migrations.AddField(
            model_name="workout", name="client_id", field=models.UUIDField(blank=True, null=True, unique=True)
        ),
        migrations.AddField(
            model_name="workout", name="sync_revision", field=models.PositiveIntegerField(default=0)
        ),
    ]
