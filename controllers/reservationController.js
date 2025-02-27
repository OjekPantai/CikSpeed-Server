const { Reservation, Symptom, Vehicle, User, Mechanic } = require("../models");

// Konstanta untuk enum
const STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  SUCCESS: "success",
  FAILED: "failed",
  CANCELED: "canceled",
};

const SERVICE_TYPE = {
  MAJOR: "major",
  REGULAR: "regular",
};

// Konstanta untuk jam operasional
const OPERATING_HOURS = [
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

// Fungsi bantu untuk mendapatkan waktu berikutnya dalam format HH:MM
const getNextTime = (time) => {
  const nextTime = new Date(`1970-01-01T${time}:00`);
  nextTime.setHours(nextTime.getHours() + 1);
  return nextTime.toTimeString().slice(0, 5); // Format HH:MM
};

// Validasi tanggal reservasi (minimal H+1)
const isValidDate = (inputDate) => {
  const today = new Date();
  today.setDate(today.getDate() + 1);
  today.setHours(0, 0, 0, 0);

  const selectedDate = new Date(inputDate);
  selectedDate.setHours(0, 0, 0, 0);

  return selectedDate >= today;
};

// Helper untuk memeriksa ketersediaan slot waktu
const checkSlotAvailability = async (date, time, serviceType) => {
  const timesToCheck =
    serviceType === SERVICE_TYPE.MAJOR ? [time, getNextTime(time)] : [time];

  const reservations = await Reservation.findAll({
    where: { date, time: timesToCheck },
  });

  return reservations.length < 2;
};

// Buat reservasi (customer)
const createReservation = async (req, res) => {
  const {
    date,
    time,
    symptomIds,
    description,
    vehicleId,
    otherSymptomDescription,
  } = req.body;

  try {
    // Ambil data user yang sedang login
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Vehicle }],
    });

    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    // Periksa apakah user memiliki kendaraan
    if (!user.Vehicles || user.Vehicles.length === 0) {
      return res.status(400).json({ error: "User tidak memiliki kendaraan" });
    }

    // validasi wajib memasukkan data kendaraan
    if (!vehicleId) {
      return res.status(400).json({ error: "Kendaraan harus dipilih" });
    }

    // Tentukan jenis servis berdasarkan gejala atau deskripsi gejala lain
    let serviceType = SERVICE_TYPE.REGULAR;
    let symptoms = [];

    if (symptomIds && symptomIds.length > 0) {
      symptoms = await Symptom.findAll({ where: { id: symptomIds } });
      serviceType = symptoms.some((s) => s.serviceType === SERVICE_TYPE.MAJOR)
        ? SERVICE_TYPE.MAJOR
        : SERVICE_TYPE.REGULAR;
    }

    // Periksa ketersediaan slot waktu
    if (time) {
      const isSlotAvailable = await checkSlotAvailability(
        date,
        time,
        serviceType
      );

      if (!isSlotAvailable) {
        return res.status(400).json({ error: "Slot waktu tidak tersedia" });
      }
    }

    // Buat reservasi dengan kendaraan yang dipilih
    const reservation = await Reservation.create({
      date,
      time,
      serviceType,
      status: STATUS.PENDING,
      description,
      otherSymptomDescription,
      userId: req.user.id,
      vehicleId,
    });

    // Hubungkan reservasi dengan gejala yang dipilih
    if (symptomIds && symptomIds.length > 0) {
      await reservation.addSymptoms(symptoms);
    }

    // Kirim respons dengan data reservasi dan gejala yang dipilih
    const reservationWithSymptoms = await Reservation.findByPk(reservation.id, {
      include: [
        { model: Symptom, through: { attributes: [] } },
        { model: Vehicle },
      ],
    });

    res.status(201).json(reservationWithSymptoms);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Gagal membuat reservasi", details: error.message });
  }
};

// Mendapatkan riwayat reservasi seluruh user
const getAllHistoryReservations = async (req, res) => {
  try {
    const historyReservations = await Reservation.findAll({
      where: { status: [STATUS.SUCCESS, STATUS.FAILED] },
      include: [
        { model: Vehicle, paranoid: false },
        { model: Symptom, through: { attributes: [] } },
        { model: Mechanic, attributes: ["id", "name", "phoneNumber"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!historyReservations.length) {
      return res
        .status(404)
        .json({ error: "Tidak ada riwayat reservasi ditemukan" });
    }

    res.json(historyReservations);
  } catch (error) {
    res.status(400).json({
      error: "Gagal mengambil data riwayat reservasi",
      details: error.message,
    });
  }
};

// Mendapatkan riwayat reservasi customer
const getHistoryReservations = async (req, res) => {
  try {
    const historyReservations = await Reservation.findAll({
      where: {
        userId: req.user.id,
        status: [STATUS.SUCCESS, STATUS.FAILED],
      },
      include: [
        { model: Vehicle, paranoid: false },
        { model: Symptom, through: { attributes: [] } },
        { model: Mechanic, attributes: ["id", "name", "phoneNumber"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!historyReservations.length) {
      return res
        .status(404)
        .json({ error: "Tidak ada riwayat reservasi ditemukan" });
    }

    res.json(historyReservations);
  } catch (error) {
    res.status(400).json({
      error: "Gagal mengambil data riwayat reservasi",
      details: error.message,
    });
  }
};

// Update reservasi
const updateReservation = async (req, res) => {
  const { id } = req.params;
  const { date, time, status, serviceType, mechanicId } = req.body;

  try {
    const reservation = await Reservation.findByPk(id);
    if (!reservation) {
      return res.status(404).json({ error: "Reservasi tidak ditemukan" });
    }

    // Validasi input data
    if (date && !isValidDate(date)) {
      return res.status(400).json({
        error: "Tanggal harus dimulai dari satu hari setelah hari ini",
      });
    }

    if (status && !Object.values(STATUS).includes(status)) {
      return res.status(400).json({ error: "Status tidak valid" });
    }

    if (serviceType && !Object.values(SERVICE_TYPE).includes(serviceType)) {
      return res.status(400).json({ error: "Jenis servis tidak valid" });
    }

    if (time && date) {
      const isSlotAvailable = await checkSlotAvailability(
        date,
        time,
        serviceType || reservation.serviceType
      );

      if (!isSlotAvailable) {
        return res.status(400).json({ error: "Slot waktu tidak tersedia" });
      }
    }

    if (mechanicId) {
      const mechanic = await Mechanic.findByPk(mechanicId);
      if (!mechanic) {
        return res.status(404).json({ error: "Mekanik tidak ditemukan" });
      }
    }

    // Persiapkan data untuk update
    const updatedData = {};
    if (date) updatedData.date = date;
    if (time) updatedData.time = time;
    if (status) updatedData.status = status;
    if (mechanicId) updatedData.mechanicId = mechanicId;
    if (serviceType) updatedData.serviceType = serviceType;

    await Reservation.update(updatedData, { where: { id } });

    const updatedReservation = await Reservation.findByPk(id, {
      include: [{ model: Vehicle }, { model: Mechanic }],
    });

    res.status(200).json(updatedReservation);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Gagal mengupdate reservasi", details: error.message });
  }
};

// Daftar reservasi terbaru customer
const getCustomerReservation = async (req, res) => {
  try {
    const latestReservation = await Reservation.findOne({
      where: {
        userId: req.user.id,
        status: [STATUS.PENDING, STATUS.CONFIRMED, STATUS.CANCELED],
      },
      include: [
        { model: Vehicle, paranoid: false },
        { model: User },
        { model: Symptom, through: { attributes: [] } },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!latestReservation) {
      return res.status(404).json({
        success: false,
        message: "Tidak ada data reservasi yang ditemukan untuk pengguna ini.",
      });
    }

    res.status(200).json({
      success: true,
      data: latestReservation,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Gagal mengambil data reservasi",
      details: error.message,
    });
  }
};

// Dapatkan semua reservasi (admin/frontdesk)
const getAllReservations = async (req, res) => {
  try {
    const reservations = await Reservation.findAll({
      include: [
        { model: Vehicle, paranoid: false },
        { model: User },
        { model: Symptom, through: { attributes: [] } },
        { model: Mechanic, attributes: ["id", "name", "phoneNumber"] },
      ],
      order: [
        ["date", "ASC"],
        ["time", "ASC"],
      ],
    });
    res.json(reservations);
  } catch (error) {
    res.status(400).json({
      error: "Gagal mengambil data semua reservasi",
      details: error.message,
    });
  }
};

// Memeriksa slot waktu yang tersedia
const checkAvailableSlots = async (req, res) => {
  const { date, serviceType } = req.query;

  try {
    // Ambil semua reservasi pada tanggal yang dipilih
    const reservations = await Reservation.findAll({
      where: { date },
      attributes: ["time", "serviceType"],
    });

    // Hitung jumlah reservasi per slot waktu dengan reduce
    const slotCounts = reservations.reduce((acc, { time, serviceType }) => {
      acc[time] = (acc[time] || 0) + 1;
      if (serviceType === SERVICE_TYPE.MAJOR) {
        acc[getNextTime(time)] = (acc[getNextTime(time)] || 0) + 1;
      }
      return acc;
    }, {});

    // Filter slot waktu yang tersedia
    const availableSlots = OPERATING_HOURS.filter((slot, index) => {
      if (serviceType === SERVICE_TYPE.MAJOR) {
        const nextSlot = OPERATING_HOURS[index + 1];
        // Hanya tampilkan slot yang memiliki slot berikutnya dan keduanya tersedia
        return (
          nextSlot &&
          (slotCounts[slot] || 0) < 2 &&
          (slotCounts[nextSlot] || 0) < 2
        );
      }
      return (slotCounts[slot] || 0) < 2;
    });

    res.json(availableSlots);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Gagal memeriksa slot waktu", details: error.message });
  }
};

module.exports = {
  createReservation,
  getCustomerReservation,
  getAllReservations,
  getHistoryReservations,
  updateReservation,
  checkAvailableSlots,
  getAllHistoryReservations,
};
